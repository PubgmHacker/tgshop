import { prisma, LedgerType, PaymentProvider, PaymentStatus, type Prisma } from '@tgshop/db'
import type { Payment } from '@tgshop/db'
import { credit } from '@tgshop/core'
import { newId } from '../lib/ids.js'

/** Credits a confirmed top-up to a user's balance ledger. Idempotent per payment. */
export async function creditTopup(userId: string, amountCents: number, paymentId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await credit(tx, {
      userId,
      amountCents,
      type: LedgerType.TOPUP,
      paymentId,
      idempotencyKey: `topup:${paymentId}`
    })
  })
}

export interface SettledCryptoBotTopup {
  payment: Payment
  claimed: boolean
}

/**
 * Claims and credits a paid CryptoBot top-up atomically. The webhook and the
 * polling worker can arrive at the same time; the guarded claim plus the shared
 * ledger idempotency key makes exactly one of them perform the credit.
 */
export async function settleCryptoBotTopup(
  payment: Payment,
  invoiceId: string,
  amountCents: number,
  rawPayload: object
): Promise<SettledCryptoBotTopup> {
  if (payment.status === PaymentStatus.PAID) return { payment, claimed: false }
  const settleableStatuses: readonly PaymentStatus[] = [
    PaymentStatus.PENDING,
    PaymentStatus.CONFIRMING,
    PaymentStatus.UNDERPAID
  ]
  if (!settleableStatuses.includes(payment.status)) {
    return { payment, claimed: false }
  }

  const originalRaw =
    payment.rawPayload && typeof payment.rawPayload === 'object' && !Array.isArray(payment.rawPayload)
      ? (payment.rawPayload as Record<string, unknown>)
      : {}
  const mergedRaw = { ...originalRaw, successfulPayment: rawPayload } as Prisma.InputJsonValue

  const claimed = await prisma.$transaction(async (tx) => {
    const updated = await tx.payment.updateMany({
      where: { id: payment.id, status: { not: PaymentStatus.PAID } },
      data: { providerInvoiceId: invoiceId, status: PaymentStatus.PAID, rawPayload: mergedRaw }
    })
    if (updated.count === 0) return false

    await credit(tx, {
      userId: payment.userId,
      amountCents,
      type: LedgerType.TOPUP,
      paymentId: payment.id,
      idempotencyKey: `topup:${payment.id}`
    })
    return true
  })

  return { payment, claimed }
}

export function newTopupReference(): string {
  return `topup_${newId()}`
}

/**
 * Finds the PENDING Payment a top-up invoice was created against.
 *
 * Every top-up goes through domain/payments.ts `createInvoice()`, which writes
 * the row (with the real userId) *before* the provider can call back — so the
 * webhook never has to guess who paid. Matching is by provider invoice id
 * first, falling back to the opaque `topup_*` reference we echoed to CryptoBot
 * for invoices created before the id was known.
 */
export async function findTopupPayment(invoiceId: string, reference: string): Promise<Payment | null> {
  const byInvoice = await prisma.payment.findUnique({
    where: { provider_providerInvoiceId: { provider: PaymentProvider.CRYPTOBOT, providerInvoiceId: invoiceId } }
  })
  // Never let a forged `topup_*` payload borrow an order payment's invoice id.
  // The reference and the null order link must both describe a top-up.
  if (byInvoice && byInvoice.orderId === null && referenceOf(byInvoice.rawPayload) === reference) return byInvoice

  return prisma.payment.findFirst({
    where: {
      provider: PaymentProvider.CRYPTOBOT,
      orderId: null,
      rawPayload: { path: ['reference'], equals: reference }
    },
    orderBy: { createdAt: 'desc' }
  })
}

function referenceOf(rawPayload: unknown): string | null {
  if (rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)) {
    const reference = (rawPayload as Record<string, unknown>)['reference']
    if (typeof reference === 'string') return reference
  }
  return null
}

/** The pending Stars top-up Payment created for a `topup_*` invoice payload, if any. */
export async function findStarsTopupPayment(reference: string): Promise<Payment | null> {
  return prisma.payment.findFirst({
    where: {
      provider: PaymentProvider.STARS,
      orderId: null,
      rawPayload: { path: ['reference'], equals: reference }
    },
    orderBy: { createdAt: 'desc' }
  })
}

/** USD cents stamped on the payment at invoice creation (see domain/payments.ts). */
function amountCentsOf(payment: Payment): number | null {
  const raw = payment.rawPayload
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const cents = (raw as Record<string, unknown>)['amountCents']
    if (typeof cents === 'number' && Number.isInteger(cents) && cents > 0) return cents
  }
  return null
}

export interface SettledStarsTopup {
  payment: Payment
  amountCents: number
}

/**
 * Settles a Stars top-up after successful_payment: Payment -> PAID and the
 * balance credited, atomically. Returns null when there is nothing to do —
 * unknown reference, cents missing from the payload, or already settled
 * (grammY redelivers updates whose handler threw, so this MUST be repeat-safe;
 * the guarded updateMany plus the `topup:<paymentId>` ledger key make the
 * credit exactly-once).
 */
export async function settleStarsTopup(
  reference: string,
  telegramChargeId: string,
  rawPayload: object,
  options: { userId?: string; totalStars?: number } = {}
): Promise<SettledStarsTopup | null> {
  const payment = await findStarsTopupPayment(reference)
  if (!payment) return null

  if (options.userId !== undefined && payment.userId !== options.userId) return null
  if (
    options.totalStars !== undefined &&
    (!Number.isSafeInteger(options.totalStars) || options.totalStars <= 0 || payment.amount !== BigInt(options.totalStars))
  ) {
    return null
  }

  const amountCents = amountCentsOf(payment)
  if (amountCents === null) return null

  // Merge rather than replace: `reference`/`amountCents` written at invoice
  // creation stay on the row for traceability alongside Telegram's receipt.
  const originalRaw =
    payment.rawPayload && typeof payment.rawPayload === 'object' && !Array.isArray(payment.rawPayload)
      ? (payment.rawPayload as Record<string, unknown>)
      : {}
  const mergedRaw = { ...originalRaw, successfulPayment: rawPayload } as Prisma.InputJsonValue

  const settled = await prisma.$transaction(async (tx) => {
    const claimed = await tx.payment.updateMany({
      where: { id: payment.id, status: { in: [PaymentStatus.PENDING, PaymentStatus.CONFIRMING] } },
      data: { status: PaymentStatus.PAID, txHash: telegramChargeId, rawPayload: mergedRaw }
    })
    if (claimed.count === 0) return false

    await credit(tx, {
      userId: payment.userId,
      amountCents,
      type: LedgerType.TOPUP,
      paymentId: payment.id,
      idempotencyKey: `topup:${payment.id}`
    })
    return true
  })

  return settled ? { payment, amountCents } : null
}
