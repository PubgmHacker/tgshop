import { randomBytes } from 'node:crypto'
import { nanoid } from 'nanoid'
import type { Order, Plan, PrismaClient, Product, StockItem } from '@tgshop/db'
import { DeliveryType, LedgerType, OrderStatus, StockStatus } from '@tgshop/db'
import { decrypt, encrypt } from './crypto.js'
import { credit, type PrismaTx } from './ledger.js'
import { markDelivered, markDelivering, markFailed } from './orders.js'
import {
  DeliveryFailedError,
  ManualFallbackRequiredError,
  OrderNotFoundError,
  OrderStateError,
  StockUnavailableError
} from './errors.js'

// ─────────────────────────────────────────────────────────────────────────────
// Delivery: one entry point, four strategies dispatched on Product.deliveryType.
//
// Two invariants drive this file:
//
// 1. A StockItem can never be handed to two orders. The claim runs inside a
//    transaction as `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1`: the row lock is
//    held until commit, and a concurrent claimer SKIPS the locked row instead of
//    blocking on it, so two parallel deliveries take two different items (or the
//    second finds none) rather than racing for one. A plain findFirst+update
//    cannot give this guarantee — both readers would see the same row.
//
// 2. deliver() is idempotent. An already-DELIVERED order returns the payload
//    decrypted from Order.deliveredPayloadEnc and consumes nothing.
// ─────────────────────────────────────────────────────────────────────────────

export interface DeliveryResult {
  payload: string
  instructions: string
}

export interface ExternalSupplier {
  fulfill(input: { orderId: string; planId: string; qty: number }, signal?: AbortSignal): Promise<{ payload: string }>
}

export interface DeliveryDeps {
  supplier?: ExternalSupplier
  now?: () => Date
  /** Additive test seams — both default to real behaviour. */
  timeoutMs?: number
  sleep?: (ms: number) => Promise<void>
}

type OrderWithPlan = Order & { plan: Plan & { product: Product } }

const EXTERNAL_ATTEMPTS = 3
const EXTERNAL_TIMEOUT_MS = 10_000
const EXTERNAL_BACKOFF_BASE_MS = 500
const BREAKER_FAILURE_THRESHOLD = 5
const BREAKER_COOLDOWN_MS = 60_000
/** Crockford-ish alphabet: no I/O/0/1 to survive being read aloud or retyped. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

interface BreakerState {
  consecutiveFailures: number
  openedAtMs: number | null
}

// Process-local, per-product circuit breaker: one dead supplier must not stall
// deliveries of every other product. Deliberately in-memory — sharing it through
// Redis would put a network hop on the hot path for what is only ever a hint,
// and a fresh worker re-learns the state within a single attempt.
const breakers = new Map<string, BreakerState>()

function breakerFor(key: string): BreakerState {
  const existing = breakers.get(key)
  if (existing) return existing
  const fresh: BreakerState = { consecutiveFailures: 0, openedAtMs: null }
  breakers.set(key, fresh)
  return fresh
}

/** Clears breaker state (all keys, or one product). Exposed for tests and admin tooling. */
export function resetCircuitBreaker(key?: string): void {
  if (key === undefined) breakers.clear()
  else breakers.delete(key)
}

function isBreakerOpen(state: BreakerState, nowMs: number): boolean {
  if (state.openedAtMs === null) return false
  if (nowMs - state.openedAtMs >= BREAKER_COOLDOWN_MS) {
    // Cooldown elapsed → half-open: let exactly one attempt through to probe,
    // so a single failure re-opens the breaker immediately.
    state.openedAtMs = null
    state.consecutiveFailures = BREAKER_FAILURE_THRESHOLD - 1
    return false
  }
  return true
}

function instructionsFor(deliveryType: DeliveryType): string {
  switch (deliveryType) {
    case DeliveryType.STOCK_POOL:
      return 'Your account credentials are below. Change the password after first login and do not share them.'
    case DeliveryType.UNIQUE_CODE:
      return 'Redeem the single-use code below in the official app or store page.'
    case DeliveryType.EXTERNAL_API:
      return 'Your top-up was submitted to the provider. Keep the reference below for support.'
    case DeliveryType.MANUAL_FALLBACK:
      return 'An operator is preparing your order manually and will send it here shortly.'
    default:
      return 'Your order details are below.'
  }
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Delivers a PAID/DELIVERING order and returns the plaintext payload.
 *
 * Throws:
 *  - OrderNotFoundError / OrderStateError for an order that cannot be delivered;
 *  - StockUnavailableError when a pool is empty;
 *  - ManualFallbackRequiredError for MANUAL_FALLBACK products — NOT a failure,
 *    the order stays DELIVERING and an admin finishes it (caller must alert);
 *  - DeliveryFailedError when an external supplier is exhausted, after the order
 *    has already been marked FAILED and refunded to the user's balance.
 */
export async function deliver(
  prisma: PrismaClient,
  orderId: string,
  deps: DeliveryDeps = {}
): Promise<DeliveryResult> {
  const order = (await prisma.order.findUnique({
    where: { id: orderId },
    include: { plan: { include: { product: true } } }
  })) as OrderWithPlan | null

  if (!order) throw new OrderNotFoundError(orderId)

  const product = order.plan.product
  const instructions = instructionsFor(product.deliveryType)

  // Idempotency gate: never consume a second item for an order already served.
  if (order.status === OrderStatus.DELIVERED) {
    if (!order.deliveredPayloadEnc) {
      throw new DeliveryFailedError(orderId, 'order is DELIVERED but carries no stored payload')
    }
    return { payload: decrypt(order.deliveredPayloadEnc), instructions }
  }

  if (order.status !== OrderStatus.PAID && order.status !== OrderStatus.DELIVERING) {
    throw new OrderStateError(order.status, OrderStatus.DELIVERING)
  }

  await markDelivering(prisma, orderId)

  switch (product.deliveryType) {
    case DeliveryType.STOCK_POOL:
      return deliverFromPool(prisma, order, instructions)

    case DeliveryType.UNIQUE_CODE: {
      const template = readCodeTemplate(product.externalConfig)
      // A UNIQUE_CODE product without a template is just a pool of one-off codes,
      // which is exactly the STOCK_POOL mechanic — reuse it rather than inventing
      // a code the upstream vendor has never issued.
      return template === null
        ? deliverFromPool(prisma, order, instructions)
        : deliverGeneratedCode(prisma, order, template, instructions)
    }

    case DeliveryType.EXTERNAL_API:
      return deliverFromExternalApi(prisma, order, deps, instructions)

    case DeliveryType.MANUAL_FALLBACK:
      // Left in DELIVERING on purpose; the throw is the admin-alert signal.
      throw new ManualFallbackRequiredError(orderId)

    default:
      throw new DeliveryFailedError(
        orderId,
        `unsupported deliveryType ${String(product.deliveryType)}`
      )
  }
}

async function deliverFromPool(
  prisma: PrismaClient,
  order: OrderWithPlan,
  instructions: string
): Promise<DeliveryResult> {
  const payload = await prisma.$transaction(async (tx) => {
    // An item may already belong to this order: RESERVED at checkout, or SOLD by
    // a run that crashed before marking the order DELIVERED. Reuse it either way.
    let item: StockItem | null = await tx.stockItem.findFirst({
      where: { orderId: order.id, status: { in: [StockStatus.RESERVED, StockStatus.SOLD] } }
    })

    if (!item) {
      const claimed = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM stock_items
        WHERE "planId" = ${order.planId} AND status = 'AVAILABLE'
        ORDER BY "createdAt"
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `
      const claimedId = claimed[0]?.id
      if (!claimedId) throw new StockUnavailableError(order.planId)

      item = await tx.stockItem.update({
        where: { id: claimedId },
        data: { status: StockStatus.SOLD, orderId: order.id, reservedUntil: null }
      })
    } else if (item.status !== StockStatus.SOLD) {
      item = await tx.stockItem.update({
        where: { id: item.id },
        data: { status: StockStatus.SOLD, orderId: order.id, reservedUntil: null }
      })
    }

    // Re-encrypt into the order's own ciphertext instead of copying payloadEnc:
    // the order then carries an independent copy, so rotating or re-keying a
    // StockItem later cannot corrupt delivery history.
    const plaintext = decrypt(item.payloadEnc)
    await markDelivered(tx, order.id, encrypt(plaintext))
    return plaintext
  })

  return { payload, instructions }
}

interface ExternalCodeConfig {
  codeTemplate?: unknown
  template?: unknown
}

/** Reads a code template out of Product.externalConfig, or null when absent. */
export function readCodeTemplate(externalConfig: unknown): string | null {
  if (typeof externalConfig !== 'object' || externalConfig === null || Array.isArray(externalConfig)) {
    return null
  }
  const { codeTemplate, template } = externalConfig as ExternalCodeConfig
  const raw = typeof codeTemplate === 'string' ? codeTemplate : template
  if (typeof raw !== 'string' || raw.trim() === '') return null
  return raw
}

/**
 * Whether checkout must collect a delivery email from the buyer, read from
 * Product.externalConfig ({"requiresEmail": true}). Strictly boolean true —
 * a string "true" or 1 left by a hand-edited config does not count, so a
 * malformed config degrades to "no email asked" rather than a stuck checkout.
 */
export function readRequiresEmail(externalConfig: unknown): boolean {
  if (typeof externalConfig !== 'object' || externalConfig === null || Array.isArray(externalConfig)) {
    return false
  }
  return (externalConfig as { requiresEmail?: unknown }).requiresEmail === true
}

/**
 * Whether a product is served out of the StockItem pool — i.e. whether its
 * plans have a countable stock level. UNIQUE_CODE counts only when it has no
 * generator template, matching the dispatch in deliver().
 */
export function isPoolBacked(deliveryType: DeliveryType, externalConfig: unknown): boolean {
  if (deliveryType === DeliveryType.STOCK_POOL) return true
  if (deliveryType === DeliveryType.UNIQUE_CODE) return readCodeTemplate(externalConfig) === null
  return false
}

/**
 * Expands {RANDOM8}, {ORDER} and {NANOID} placeholders. Every occurrence gets
 * its own value, so `{RANDOM8}-{RANDOM8}` yields two different groups.
 */
export function renderCodeTemplate(template: string, orderId: string): string {
  return template
    .replace(/\{RANDOM8\}/g, () => randomCode(8))
    .replace(/\{NANOID\}/g, () => nanoid())
    .replace(/\{ORDER\}/g, orderId)
}

/**
 * CSPRNG-backed code, never Math.random: these codes are the redeemable good.
 * The alphabet is 32 chars and 256 % 32 === 0, so the modulo is bias-free.
 */
function randomCode(length: number): string {
  const bytes = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) {
    const byte = bytes[i] ?? 0
    out += CODE_ALPHABET[byte % CODE_ALPHABET.length] ?? ''
  }
  return out
}

async function deliverGeneratedCode(
  prisma: PrismaClient,
  order: OrderWithPlan,
  template: string,
  instructions: string
): Promise<DeliveryResult> {
  const code = renderCodeTemplate(template, order.id)
  await markDelivered(prisma, order.id, encrypt(code))
  return { payload: code, instructions }
}

async function deliverFromExternalApi(
  prisma: PrismaClient,
  order: OrderWithPlan,
  deps: DeliveryDeps,
  instructions: string
): Promise<DeliveryResult> {
  const nowFn = deps.now ?? ((): Date => new Date())
  const sleep = deps.sleep ?? defaultSleep
  const timeoutMs = deps.timeoutMs ?? EXTERNAL_TIMEOUT_MS
  const breaker = breakerFor(order.plan.productId)

  if (!deps.supplier) {
    const reason = 'no external supplier configured for this product'
    await failAndRefund(prisma, order, reason)
    throw new DeliveryFailedError(order.id, reason)
  }
  const supplier = deps.supplier

  if (isBreakerOpen(breaker, nowFn().getTime())) {
    // Fail fast WITHOUT failing the order: the supplier is known-down, so this
    // stays retryable and no refund is issued for an attempt we never made.
    throw new DeliveryFailedError(order.id, 'external supplier circuit breaker is open')
  }

  let lastError: unknown = null

  for (let attempt = 1; attempt <= EXTERNAL_ATTEMPTS; attempt++) {
    try {
      const response = await withTimeout(
        (signal) => supplier.fulfill({ orderId: order.id, planId: order.planId, qty: order.qty }, signal),
        timeoutMs,
        order.id
      )
      if (!response.payload) {
        throw new DeliveryFailedError(order.id, 'external supplier returned an empty payload')
      }

      breaker.consecutiveFailures = 0
      breaker.openedAtMs = null

      await markDelivered(prisma, order.id, encrypt(response.payload))
      return { payload: response.payload, instructions }
    } catch (err) {
      lastError = err
      breaker.consecutiveFailures += 1
      if (breaker.consecutiveFailures >= BREAKER_FAILURE_THRESHOLD) {
        breaker.openedAtMs = nowFn().getTime()
      }
      if (attempt < EXTERNAL_ATTEMPTS) {
        await sleep(EXTERNAL_BACKOFF_BASE_MS * 2 ** (attempt - 1))
      }
    }
  }

  const reason = lastError instanceof Error ? lastError.message : String(lastError)
  await failAndRefund(prisma, order, reason)
  throw new DeliveryFailedError(
    order.id,
    `external supplier failed after ${EXTERNAL_ATTEMPTS} attempts: ${reason}`
  )
}

/**
 * Marks the order FAILED and puts the money back on the user's balance in ONE
 * transaction, so we can never end up with a failed order the customer paid for.
 * The idempotency key matches apps/worker's own auto-refund key, so whichever of
 * the two gets there first, the user is credited exactly once.
 */
async function failAndRefund(
  prisma: PrismaClient,
  order: OrderWithPlan,
  reason: string
): Promise<void> {
  await prisma.$transaction(async (tx: PrismaTx) => {
    await markFailed(tx, order.id, reason)
    if (order.amountCents > 0) {
      await credit(tx, {
        userId: order.userId,
        amountCents: order.amountCents,
        type: LedgerType.REFUND,
        orderId: order.id,
        idempotencyKey: `delivery-failed-refund:${order.id}`,
        comment: `Auto-refund: delivery failed (${reason})`
      })
    }
  })
}

async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, ms: number, orderId: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const controller = new AbortController()
  try {
    return await Promise.race([
      run(controller.signal),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new DeliveryFailedError(orderId, `external supplier timed out after ${ms}ms`)),
          ms
        )
      })
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    controller.abort()
  }
}
