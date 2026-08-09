import { prisma, LedgerType, PaymentProvider } from '@tgshop/db'
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
