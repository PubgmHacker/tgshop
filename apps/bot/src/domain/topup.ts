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
  if (byInvoice) return byInvoice

  return prisma.payment.findFirst({
    where: {
      provider: PaymentProvider.CRYPTOBOT,
      orderId: null,
      rawPayload: { path: ['reference'], equals: reference }
    },
    orderBy: { createdAt: 'desc' }
  })
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
  rawPayload: object
): Promise<SettledStarsTopup | null> {
  const payment = await findStarsTopupPayment(reference)
  if (!payment) return null

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
      where: { id: payment.id, status: { not: PaymentStatus.PAID } },
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
