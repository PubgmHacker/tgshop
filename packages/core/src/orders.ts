import type { Order, Plan, Promo } from '@tgshop/db'
import { LedgerType, OrderStatus, PaymentProvider, StockStatus } from '@tgshop/db'
import { credit, type PrismaTx } from './ledger.js'
import { computeOrderTotal } from './pricing.js'
import {
  OrderNotFoundError,
  OrderStateError,
  PromoInvalidError,
  StockUnavailableError
} from './errors.js'

// ─────────────────────────────────────────────────────────────────────────────
// Order state machine.
//
// Every status change in the system funnels through assertTransition() so the
// legal graph lives in exactly one place. Terminal states (EXPIRED, REFUNDED)
// have no outgoing edges — money that has been given back must never be able
// to walk back into a deliverable state.
//
// Same-state calls are NOT transitions: they are absent from the graph and
// therefore illegal. The two mutators that real payment providers retry
// (markPaid, markDelivering) short-circuit on their own target state *before*
// consulting the graph, which is what makes a duplicate webhook safe without
// widening the graph itself.
// ─────────────────────────────────────────────────────────────────────────────

export const ALLOWED_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  [OrderStatus.PENDING]: [OrderStatus.PAID, OrderStatus.EXPIRED, OrderStatus.FAILED],
  [OrderStatus.PAID]: [OrderStatus.DELIVERING, OrderStatus.FAILED, OrderStatus.REFUNDED],
  // DELIVERING -> REFUNDED exists for MANUAL_FALLBACK: deliver() parks those
  // orders in DELIVERING indefinitely, waiting on a human, so without this edge
  // a paid order nobody can fulfil would have no legal way back to the buyer's
  // balance. A refund racing a real delivery attempt is safe either way — the
  // loser hits assertTransition and its transaction rolls back.
  [OrderStatus.DELIVERING]: [OrderStatus.DELIVERED, OrderStatus.FAILED, OrderStatus.REFUNDED],
  [OrderStatus.DELIVERED]: [OrderStatus.REFUNDED],
  [OrderStatus.FAILED]: [OrderStatus.REFUNDED],
  [OrderStatus.EXPIRED]: [],
  [OrderStatus.REFUNDED]: []
}

/** Throws OrderStateError unless `from -> to` is an edge in ALLOWED_TRANSITIONS. */
export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  const allowed = ALLOWED_TRANSITIONS[from]
  if (!allowed.includes(to)) {
    throw new OrderStateError(from, to)
  }
}

export interface CreateOrderInput {
  userId: string
  planId: string
  qty: number
  provider: PaymentProvider
  promoCode?: string
  idempotencyKey: string
  expiresInMinutes?: number
  /** Delivery address for requiresEmail products; most orders carry none. */
  customerEmail?: string | null
}

const DEFAULT_ORDER_EXPIRY_MINUTES = 20
const MINUTE_MS = 60 * 1000

/** Postgres unique-constraint violation, detected structurally to avoid importing Prisma's runtime. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'P2002'
  )
}

async function requireActivePlan(tx: PrismaTx, planId: string): Promise<Plan> {
  const plan = await tx.plan.findUnique({ where: { id: planId } })
  if (!plan || !plan.isActive) {
    throw new StockUnavailableError(planId)
  }
  return plan
}

async function requirePromo(tx: PrismaTx, code: string): Promise<Promo> {
  const promo = await tx.promo.findUnique({ where: { code } })
  if (!promo) {
    throw new PromoInvalidError(`promo ${code} does not exist`)
  }
  return promo
}

async function loadOrder(tx: PrismaTx, orderId: string): Promise<Order> {
  const order = await tx.order.findUnique({ where: { id: orderId } })
  if (!order) {
    throw new OrderNotFoundError(orderId)
  }
  return order
}

/**
 * Releases any stock still merely RESERVED for this order back into the pool.
 * SOLD items are deliberately left alone: once a credential has been handed to
 * a customer it is burned, so a refund must not re-sell it to somebody else.
 */
async function releaseReservedStock(tx: PrismaTx, orderId: string): Promise<void> {
  await tx.stockItem.updateMany({
    where: { orderId, status: StockStatus.RESERVED },
    data: { status: StockStatus.AVAILABLE, orderId: null, reservedUntil: null }
  })
}

/**
 * Creates a PENDING order, pricing it through computeOrderTotal (integer cents).
 *
 * Idempotent on `idempotencyKey`: a repeat call returns the SAME order row and
 * never creates a second one. Two concurrent callers with one key race on the
 * unique index rather than on a read — the loser catches P2002 and re-reads the
 * winner's row, so the caller still gets exactly one order.
 */
/**
 * Atomically claims one use of a capped promo.
 *
 * `computeOrderTotal()` already checks `usedCount >= maxUses`, but a check
 * followed by a separate write is a TOCTOU race: two concurrent orders both
 * read usedCount=0 against maxUses=1 and both succeed. This does the check and
 * the increment in ONE statement, so the database serializes the contention and
 * exactly `maxUses` orders can ever claim the code.
 *
 * Prisma's query builder cannot compare two columns of the same row
 * (`usedCount < maxUses`), hence raw SQL. Returns false when the promo is
 * exhausted or no longer active.
 */
async function claimPromoUse(tx: PrismaTx, promoId: string): Promise<boolean> {
  const affected = await tx.$executeRaw`
    UPDATE promos
       SET "usedCount" = "usedCount" + 1
     WHERE id = ${promoId}
       AND "isActive" = true
       AND ("maxUses" IS NULL OR "usedCount" < "maxUses")
  `
  return affected > 0
}

/**
 * Returns a promo use to the pool when an order that claimed one never
 * completes (expired or refunded). Floored at zero so a double release can
 * never drive the counter negative and hand out free uses.
 */
async function releasePromoUse(tx: PrismaTx, promoId: string): Promise<void> {
  await tx.$executeRaw`
    UPDATE promos
       SET "usedCount" = GREATEST("usedCount" - 1, 0)
     WHERE id = ${promoId}
  `
}

export async function createOrder(tx: PrismaTx, input: CreateOrderInput): Promise<Order> {
  const existing = await tx.order.findUnique({ where: { idempotencyKey: input.idempotencyKey } })
  if (existing) return existing

  const plan = await requireActivePlan(tx, input.planId)
  const promo = input.promoCode ? await requirePromo(tx, input.promoCode) : null
  const pricing = computeOrderTotal(plan, input.qty, promo)

  // Claim the use before creating the order: the discount is only valid if a
  // use was actually available, and the claim is what enforces maxUses.
  if (promo) {
    const claimed = await claimPromoUse(tx, promo.id)
    if (!claimed) {
      throw new PromoInvalidError(`promo ${promo.code} has no uses left`)
    }
  }

  const expiryMinutes = input.expiresInMinutes ?? DEFAULT_ORDER_EXPIRY_MINUTES

  try {
    return await tx.order.create({
      data: {
        userId: input.userId,
        planId: plan.id,
        qty: input.qty,
        amountCents: pricing.totalCents,
        currency: 'USD',
        provider: input.provider,
        status: OrderStatus.PENDING,
        idempotencyKey: input.idempotencyKey,
        customerEmail: input.customerEmail?.trim() || null,
        promoId: promo?.id ?? null,
        expiresAt: new Date(Date.now() + expiryMinutes * MINUTE_MS)
      }
    })
  } catch (err) {
    if (isUniqueViolation(err)) {
      const winner = await tx.order.findUnique({ where: { idempotencyKey: input.idempotencyKey } })
      // The concurrent winner already claimed its own use; ours would leak.
      if (winner) {
        if (promo) await releasePromoUse(tx, promo.id)
        return winner
      }
    }
    if (promo) await releasePromoUse(tx, promo.id)
    throw err
  }
}

/**
 * Marks an order PAID. IDEMPOTENT by design: providers resend webhooks, and a
 * second delivery of the same payment event must not re-credit anything, so an
 * order already in PAID / DELIVERING / DELIVERED is returned untouched.
 */
export async function markPaid(
  tx: PrismaTx,
  orderId: string,
  meta?: { externalId?: string }
): Promise<Order> {
  const order = await loadOrder(tx, orderId)

  if (
    order.status === OrderStatus.PAID ||
    order.status === OrderStatus.DELIVERING ||
    order.status === OrderStatus.DELIVERED
  ) {
    return order
  }

  assertTransition(order.status, OrderStatus.PAID)

  return tx.order.update({
    where: { id: orderId },
    data: {
      status: OrderStatus.PAID,
      paidAt: order.paidAt ?? new Date(),
      externalId: meta?.externalId ?? order.externalId
    }
  })
}

/** Marks an order DELIVERING. Retry-safe: an order already DELIVERING is returned as-is. */
export async function markDelivering(tx: PrismaTx, orderId: string): Promise<Order> {
  const order = await loadOrder(tx, orderId)
  if (order.status === OrderStatus.DELIVERING) return order

  assertTransition(order.status, OrderStatus.DELIVERING)

  return tx.order.update({
    where: { id: orderId },
    data: { status: OrderStatus.DELIVERING }
  })
}

/** Marks an order DELIVERED and stores the (already encrypted) delivered payload. */
export async function markDelivered(
  tx: PrismaTx,
  orderId: string,
  deliveredPayloadEnc: string
): Promise<Order> {
  const order = await loadOrder(tx, orderId)
  assertTransition(order.status, OrderStatus.DELIVERED)

  return tx.order.update({
    where: { id: orderId },
    data: {
      status: OrderStatus.DELIVERED,
      deliveredPayloadEnc,
      deliveredAt: new Date()
    }
  })
}

/** Marks an order FAILED and releases any stock reserved for it. Does NOT refund — see refundOrder. */
export async function markFailed(tx: PrismaTx, orderId: string, reason: string): Promise<Order> {
  const order = await loadOrder(tx, orderId)
  assertTransition(order.status, OrderStatus.FAILED)

  await releaseReservedStock(tx, orderId)

  const updated = await tx.order.update({
    where: { id: orderId },
    data: { status: OrderStatus.FAILED }
  })

  await tx.auditLog.create({
    data: {
      actorType: 'system',
      actorId: 'core.orders',
      action: 'order.failed',
      entity: 'Order',
      entityId: orderId,
      diff: { from: order.status, to: OrderStatus.FAILED, reason }
    }
  })

  return updated
}

/** Expires an unpaid order and returns its reserved stock to the pool. */
export async function expireOrder(tx: PrismaTx, orderId: string): Promise<Order> {
  const order = await loadOrder(tx, orderId)
  assertTransition(order.status, OrderStatus.EXPIRED)

  await releaseReservedStock(tx, orderId)
  // An abandoned order must not permanently burn a capped promo's use.
  if (order.promoId) await releasePromoUse(tx, order.promoId)

  return tx.order.update({
    where: { id: orderId },
    data: { status: OrderStatus.EXPIRED }
  })
}

/**
 * Refunds an order to the user's balance and marks it REFUNDED.
 *
 * The credit is gated on "no REFUND ledger row exists for this order yet", not
 * merely on its own `refund:<orderId>` key. A failed delivery auto-refunds under
 * a DIFFERENT key (`delivery-failed-refund:<orderId>`) and leaves the order
 * FAILED — a legal source state here — so per-key idempotency alone would pay a
 * manual/agent refund of that same order a second time. The REFUNDED terminal
 * state then blocks any further transition. Refunds always land on the internal
 * balance rather than the original rail — reversing a chain transfer or a Stars
 * charge is a manual, provider-specific operation an admin performs separately.
 */
export async function refundOrder(tx: PrismaTx, orderId: string, reason: string): Promise<Order> {
  const order = await loadOrder(tx, orderId)
  assertTransition(order.status, OrderStatus.REFUNDED)

  await releaseReservedStock(tx, orderId)
  // A refunded purchase did not consume the promo, so give the use back.
  if (order.promoId) await releasePromoUse(tx, order.promoId)

  // Return the money at most once per order, whichever path already ran. Keying
  // the credit is not enough: the failed-delivery auto-refund uses a different
  // ledger key, so gate on any REFUND already booked for this order instead.
  const priorRefund = await tx.balanceTransaction.aggregate({
    where: { orderId: order.id, type: LedgerType.REFUND },
    _sum: { amountCents: true }
  })
  if (order.amountCents > 0 && (priorRefund._sum.amountCents ?? 0) === 0) {
    await credit(tx, {
      userId: order.userId,
      amountCents: order.amountCents,
      type: LedgerType.REFUND,
      orderId: order.id,
      idempotencyKey: `refund:${order.id}`,
      comment: `Refund: ${reason}`
    })
  }

  const updated = await tx.order.update({
    where: { id: orderId },
    data: { status: OrderStatus.REFUNDED }
  })

  await tx.auditLog.create({
    data: {
      actorType: 'system',
      actorId: 'core.orders',
      action: 'order.refunded',
      entity: 'Order',
      entityId: orderId,
      diff: { from: order.status, to: OrderStatus.REFUNDED, amountCents: order.amountCents, reason }
    }
  })

  return updated
}
