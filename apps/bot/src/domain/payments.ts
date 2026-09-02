import { Api } from 'grammy'
import { prisma, PaymentProvider, PaymentStatus, Prisma } from '@tgshop/db'
import type { Payment } from '@tgshop/db'
import { getSetting, tronTaggedAmountUsdt6, usdt6ToDisplay } from '@tgshop/core'
import { createCryptoBotInvoice } from '../payments/cryptobot.js'
import { amountCentsToStars } from '../payments/stars.js'
import { TRON_OPEN_STATUSES, allocateTronTag, getTronReceiveAddress } from '../payments/tron.js'
import { emitEvent } from './events.js'
import { logger } from '../lib/logger.js'
import { env } from '../config/env.js'
import { redis } from '../config/redis.js'

// ─────────────────────────────────────────────────────────────────────────────
// Provider-agnostic invoice creation shared by the Mini App order and top-up
// routes, so both go through one pipeline instead of duplicating per-provider
// branching in each handler.
//
// Every non-BALANCE provider gets a Payment row up front (status=PENDING) so
// the reconciler/worker has something to match against even if the user
// abandons checkout or a webhook is missed (docs/PAYMENTS.md).
// ─────────────────────────────────────────────────────────────────────────────

/** How long a crypto/TRON payment window stays open. */
const PAYMENT_WINDOW_MS = 20 * 60 * 1000

export interface TronPaymentDetails {
  /** The owner's static USDT-TRC20 receive address (same for every invoice). */
  address: string
  network: 'TRC20'
  /** Exact amount due in USDT smallest units (6 decimals), tagged per invoice. */
  amountUsdt6: string
  /** The same amount as the customer must type it into a wallet, e.g. "29.0057". */
  amountDisplay: string
  expiresAt: string
}

export interface InvoiceResult {
  payment: Payment
  /** Off-site payment page (CryptoBot). Null for providers without one. */
  payUrl: string | null
  /** On-chain payment instructions (TRON_TRC20). Null for other providers. */
  tron: TronPaymentDetails | null
  /** Whole Telegram Stars to charge (STARS). Null for other providers. */
  stars: number | null
}

export interface CreateInvoiceInput {
  userId: string
  amountCents: number
  provider: PaymentProvider
  description: string
  /** Opaque reference echoed back by the provider: an Order.id or a `topup_*` ref. */
  reference: string
  /** Set when this payment settles a specific order. */
  orderId?: string | null
  /** Optional total Stars override, already adjusted for quantity/discounts. */
  priceStars?: number | null
  /** Client retry key, used for top-ups that do not have an orderId. */
  idempotencyKey?: string
}

/**
 * Creates (or reuses) a provider invoice plus its Payment row.
 *
 * Idempotency: keyed on `(provider, providerInvoiceId)` for CryptoBot, and on
 * the linked orderId (or top-up retry key) for TRON invoices, so a retried
 * checkout does not mint a second invoice for the same money.
 */
export async function createInvoice(input: CreateInvoiceInput): Promise<InvoiceResult> {
  switch (input.provider) {
    case PaymentProvider.CRYPTOBOT:
      return createCryptoBotPayment(input)
    case PaymentProvider.STARS:
      return createStarsPayment(input)
    case PaymentProvider.TRON_TRC20:
      return createTronPayment(input)
    case PaymentProvider.BALANCE:
      throw new Error('createInvoice() must not be called for BALANCE; debit the ledger instead')
  }
}

async function createCryptoBotPayment(input: CreateInvoiceInput): Promise<InvoiceResult> {
  const existing = input.orderId
      ? await prisma.payment.findFirst({
        where: {
          orderId: input.orderId,
          provider: PaymentProvider.CRYPTOBOT,
          status: { in: [PaymentStatus.PENDING, PaymentStatus.CONFIRMING] }
        },
        orderBy: { createdAt: 'desc' }
      })
    : await findPaymentByIdempotency(input, PaymentProvider.CRYPTOBOT)

  if (existing) {
    const rawUrl = readRawString(existing.rawPayload, 'payUrl')
    if (rawUrl) {
      return { payment: existing, payUrl: rawUrl, tron: null, stars: null }
    }
  }

  const invoice = await createCryptoBotInvoice({
    amountUsd: (input.amountCents / 100).toFixed(2),
    description: input.description,
    payload: input.reference
  })

  const payment = await prisma.payment.upsert({
    where: {
      provider_providerInvoiceId: {
        provider: PaymentProvider.CRYPTOBOT,
        providerInvoiceId: invoice.invoiceId
      }
    },
    create: {
      orderId: input.orderId ?? null,
      userId: input.userId,
      provider: PaymentProvider.CRYPTOBOT,
      providerInvoiceId: invoice.invoiceId,
      amount: BigInt(input.amountCents),
      asset: 'USD',
      status: PaymentStatus.PENDING,
      rawPayload: {
        payUrl: invoice.payUrl,
        reference: input.reference,
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {})
      }
    },
    update: {
      rawPayload: {
        payUrl: invoice.payUrl,
        reference: input.reference,
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {})
      }
    }
  })

  return { payment, payUrl: invoice.payUrl, tron: null, stars: null }
}

// A bare Api client (no update polling) is enough for createInvoiceLink; the
// full Bot instance lives in index.ts and is not needed here.
let starsApi: Api | null = null

function getStarsApi(): Api {
  if (!starsApi) starsApi = new Api(env.BOT_TOKEN)
  return starsApi
}

/** Telegram caps invoice titles at 32 chars; description at 255. */
function clampInvoiceText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

async function createStarsPayment(input: CreateInvoiceInput): Promise<InvoiceResult> {
  const existing = input.orderId
    ? await prisma.payment.findFirst({
        where: { orderId: input.orderId, provider: PaymentProvider.STARS, status: PaymentStatus.PENDING },
        orderBy: { createdAt: 'desc' }
      })
    : await findPaymentByIdempotency(input, PaymentProvider.STARS)

  if (existing) {
    const rawUrl = readRawString(existing.rawPayload, 'payUrl')
    const rawStars = readRawPositiveInt(existing.rawPayload, 'stars')
    if (rawUrl && rawStars !== null) {
      return { payment: existing, payUrl: rawUrl, tron: null, stars: rawStars }
    }
  }

  // A per-plan override wins, otherwise use the live admin setting. The env
  // value remains only as the documented fallback when the Setting row has not
  // been created yet.
  const stars =
    input.priceStars ?? amountCentsToStars(input.amountCents, await getSetting(prisma, 'stars_usd_rate', redis))

  // createInvoiceLink gives the Mini App a URL it can open with openInvoice(),
  // so Stars work from the app, not only from the bot chat's sendInvoice flow.
  // The payload is the same `reference` the rest of the pipeline uses (an
  // Order.id or a `topup_*` ref), which is what the pre_checkout_query and
  // successful_payment handlers validate and settle by.
  const payUrl = await getStarsApi().createInvoiceLink(
    clampInvoiceText(input.description, 32),
    clampInvoiceText(input.description, 255),
    input.reference,
    '', // Stars require no provider token
    'XTR',
    [{ label: clampInvoiceText(input.description, 32), amount: stars }]
  )

  // amountCents is stored on the payload because Payment.amount holds STARS
  // (asset XTR): a top-up settle must credit the exact USD cents the user
  // asked for, not a stars->USD reconversion that can drift with the rate.
  const payment = await prisma.payment.create({
    data: {
      orderId: input.orderId ?? null,
      userId: input.userId,
      provider: PaymentProvider.STARS,
      amount: BigInt(stars),
      asset: 'XTR',
      status: PaymentStatus.PENDING,
      rawPayload: {
        stars,
        reference: input.reference,
        amountCents: input.amountCents,
        payUrl,
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {})
      }
    }
  })

  return { payment, payUrl, tron: null, stars }
}

/**
 * Marks a Stars order's Payment row PAID and announces the money.
 *
 * Stars is the one rail with no reconciler behind it: CryptoBot has the
 * payments-poll fallback and TRON has chain-scan, but a Stars charge is only
 * ever reported once, in the successful_payment update. If this row is not
 * settled here it stays PENDING forever and the order reads as unpaid in every
 * admin payments view even though Telegram has taken the customer's Stars.
 *
 * The conditional updateMany is what makes a duplicate update harmless — grammY
 * will redeliver an update whose handler threw, and the money must be announced
 * exactly once.
 */
export async function settleStarsPayment(
  orderId: string,
  telegramChargeId: string,
  rawPayload: object,
  options: { userId?: string; totalStars?: number } = {}
): Promise<boolean> {
  const payment = await prisma.payment.findFirst({
    where: { orderId, provider: PaymentProvider.STARS },
    orderBy: { createdAt: 'desc' }
  })
  if (!payment) {
    logger.error({ orderId }, 'Stars payment succeeded but no Payment row exists — order settles without one')
    return false
  }

  if (options.userId !== undefined && payment.userId !== options.userId) {
    logger.error({ orderId, paymentId: payment.id }, 'Stars payment payer does not own the order')
    return false
  }
  if (
    options.totalStars !== undefined &&
    (!Number.isSafeInteger(options.totalStars) || options.totalStars <= 0 || payment.amount !== BigInt(options.totalStars))
  ) {
    logger.error(
      { orderId, paymentId: payment.id, expectedStars: payment.amount.toString(), receivedStars: options.totalStars },
      'Stars payment amount does not match the stored invoice'
    )
    return false
  }
  if (payment.status === PaymentStatus.PAID) return true
  const settleableStatuses: readonly PaymentStatus[] = [PaymentStatus.PENDING, PaymentStatus.CONFIRMING]
  if (!settleableStatuses.includes(payment.status)) {
    logger.warn({ orderId, paymentId: payment.id, status: payment.status }, 'Stars payment is not settleable')
    return false
  }

  const originalRaw =
    payment.rawPayload && typeof payment.rawPayload === 'object' && !Array.isArray(payment.rawPayload)
      ? (payment.rawPayload as Record<string, unknown>)
      : {}
  const mergedRaw = { ...originalRaw, successfulPayment: rawPayload } as Prisma.InputJsonValue

  const settled = await prisma.payment.updateMany({
    where: { id: payment.id, status: { in: [PaymentStatus.PENDING, PaymentStatus.CONFIRMING] } },
    data: { status: PaymentStatus.PAID, txHash: telegramChargeId, rawPayload: mergedRaw }
  })
  if (settled.count === 0) {
    const current = await prisma.payment.findUnique({ where: { id: payment.id } })
    return current?.status === PaymentStatus.PAID
  }

  await emitEvent('payment.received', {
    paymentId: payment.id,
    orderId,
    userId: payment.userId,
    provider: PaymentProvider.STARS,
    // Whole Stars as a decimal string, matching the BigInt-safe wire contract.
    amount: payment.amount.toString(),
    asset: payment.asset,
    // Telegram's charge id is the closest thing Stars has to a transaction
    // hash, and it is what support quotes when reconciling a disputed charge.
    txHash: telegramChargeId
  })
  return true
}

async function createTronPayment(input: CreateInvoiceInput): Promise<InvoiceResult> {
  const receiveAddress = getTronReceiveAddress()
  if (!receiveAddress) {
    throw new Error(
      'TRON_RECEIVE_ADDRESS (or legacy TRON_SWEEP_TO_ADDRESS) is not a valid TRON address; cannot accept USDT-TRC20'
    )
  }

  // One open TRON invoice per order (or per client retry key for a top-up).
  // Re-issuing would burn a second tag and leave the customer two different
  // amounts, only one of which we would ever match.
  const existing = input.orderId
    ? await prisma.payment.findFirst({
        where: {
          orderId: input.orderId,
          provider: PaymentProvider.TRON_TRC20,
          status: { in: TRON_OPEN_STATUSES }
        },
        orderBy: { createdAt: 'desc' }
      })
    : await findPaymentByIdempotency(input, PaymentProvider.TRON_TRC20)

  if (existing) {
    const reused = tronDetailsFromPayment(existing)
    if (reused) return { payment: existing, payUrl: null, stars: null, tron: reused }
  }

  const tag = await allocateTronTag(input.amountCents, PAYMENT_WINDOW_MS)
  const amountUsdt6 = tronTaggedAmountUsdt6(input.amountCents, tag)
  const expiresAt = new Date(Date.now() + PAYMENT_WINDOW_MS)

  const payment = await prisma.payment.create({
    data: {
      orderId: input.orderId ?? null,
      userId: input.userId,
      provider: PaymentProvider.TRON_TRC20,
      amount: amountUsdt6,
      asset: 'USDT',
      network: env.TRON_NETWORK,
      address: receiveAddress,
      status: PaymentStatus.PENDING,
      rawPayload: {
        reference: input.reference,
        amountCents: input.amountCents,
        tag,
        expectedAmountUsdt6: amountUsdt6.toString(),
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {})
      }
    }
  })

  logger.info(
    { paymentId: payment.id, orderId: input.orderId ?? null, amountCents: input.amountCents, tag },
    'TRON invoice issued'
  )

  return {
    payment,
    payUrl: null,
    stars: null,
    tron: {
      address: receiveAddress,
      network: 'TRC20',
      amountUsdt6: amountUsdt6.toString(),
      amountDisplay: usdt6ToDisplay(amountUsdt6),
      expiresAt: expiresAt.toISOString()
    }
  }
}

/** Finds a non-terminal top-up payment created for the same client retry key. */
async function findPaymentByIdempotency(
  input: CreateInvoiceInput,
  provider: PaymentProvider
): Promise<Payment | null> {
  if (!input.idempotencyKey) return null
  return prisma.payment.findFirst({
    where: {
      userId: input.userId,
      orderId: null,
      provider,
      status: { notIn: [PaymentStatus.EXPIRED, PaymentStatus.FAILED] },
      rawPayload: { path: ['idempotencyKey'], equals: input.idempotencyKey }
    },
    orderBy: { createdAt: 'desc' }
  })
}

/** Reads a string field out of a Prisma Json column without asserting `any`. */
function readRawString(raw: unknown, key: string): string | null {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const value = (raw as Record<string, unknown>)[key]
    if (typeof value === 'string') return value
  }
  return null
}

function readRawPositiveInt(raw: unknown, key: string): number | null {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const value = (raw as Record<string, unknown>)[key]
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value
  }
  return null
}

/** Latest payment for an order, used to surface payment state on the checkout screen. */
export async function getLatestPaymentForOrder(orderId: string): Promise<Payment | null> {
  return prisma.payment.findFirst({ where: { orderId }, orderBy: { createdAt: 'desc' } })
}

/** Rebuilds TRON instructions for an existing pending payment (checkout polling). */
export function tronDetailsFromPayment(payment: Payment): TronPaymentDetails | null {
  if (payment.provider !== PaymentProvider.TRON_TRC20 || !payment.address) return null
  const expiresAt = new Date(payment.createdAt.getTime() + PAYMENT_WINDOW_MS)
  return {
    address: payment.address,
    network: 'TRC20',
    amountUsdt6: payment.amount.toString(),
    amountDisplay: usdt6ToDisplay(BigInt(payment.amount)),
    expiresAt: expiresAt.toISOString()
  }
}
