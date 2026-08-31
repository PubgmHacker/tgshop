import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma, PaymentProvider, PaymentStatus } from '@tgshop/db'
import { DomainError } from '@tgshop/core'
import { verifyCryptoBotSignature } from '../../payments/cryptobot.js'
import { findTopupPayment, settleCryptoBotTopup } from '../../domain/topup.js'
import { markOrderPaidAndDeliver } from '../../domain/orders.js'
import { emitEvent } from '../../domain/events.js'
import { logger } from '../../lib/logger.js'

/**
 * The invoice_paid update body, matching what Crypto Pay actually sends.
 *
 * The shop creates FIAT invoices (currency_type: 'fiat'), and for those the
 * Invoice object carries NO `asset` field — the crypto actually used arrives
 * as `paid_asset` instead. Requiring `asset` here rejected every real payment
 * webhook with 400, so CryptoBot kept redelivering and settlement silently
 * fell through to the payments-poll worker. `amount` on a fiat invoice is the
 * fiat amount, which is exactly what the top-up credit math below expects.
 */
export const cryptoBotWebhookSchema = z.object({
  update_type: z.string(),
  payload: z.object({
    invoice_id: z.number(),
    status: z.string(),
    amount: z.string(),
    asset: z.string().optional(),
    payload: z.string().optional()
  })
})

/**
 * Announces settled money to the event bus, after the row is committed.
 *
 * A failed publish must never fail the webhook: emitEvent already swallows and
 * logs, and answering 500 here would make CryptoBot redeliver a webhook whose
 * financial effect has already been applied.
 */
async function emitPaymentReceived(payment: {
  id: string
  orderId: string | null
  userId: string
  amount: bigint
  asset: string
}): Promise<void> {
  await emitEvent('payment.received', {
    paymentId: payment.id,
    orderId: payment.orderId,
    userId: payment.userId,
    provider: PaymentProvider.CRYPTOBOT,
    // Smallest-unit BigInt as a decimal string; JSON cannot carry a BigInt.
    amount: payment.amount.toString(),
    asset: payment.asset,
    // CryptoBot settles off-chain against its own ledger, so there is no
    // on-chain hash to report — unlike the TRON rail, which always has one.
    txHash: null
  })
}

/**
 * Marks an order's CryptoBot Payment row PAID and announces it.
 *
 * Conditional on the row still being PENDING, so a redelivered webhook that
 * slipped past the idempotency record cannot announce the same money twice.
 * A missing row is logged rather than thrown: the order settlement below is the
 * part that must not be skipped, and CryptoBot has already been charged.
 */
async function settleOrderPayment(
  invoiceId: string,
  orderId: string,
  amountCents: number,
  rawPayload: object
): Promise<boolean> {
  const payment = await prisma.payment.findUnique({
    where: {
      provider_providerInvoiceId: { provider: PaymentProvider.CRYPTOBOT, providerInvoiceId: invoiceId }
    }
  })
  if (!payment) {
    logger.error({ invoiceId, orderId }, 'PAID CryptoBot invoice has no matching Payment row — refusing order settlement')
    return false
  }
  if (payment.orderId !== orderId) {
    logger.error(
      { invoiceId, payloadOrderId: orderId, paymentOrderId: payment.orderId },
      'CryptoBot invoice payload does not match the stored order'
    )
    return false
  }
  if (payment.status === PaymentStatus.PAID) return true
  const settleableStatuses: readonly PaymentStatus[] = [
    PaymentStatus.PENDING,
    PaymentStatus.CONFIRMING,
    PaymentStatus.UNDERPAID
  ]
  if (!settleableStatuses.includes(payment.status)) {
    logger.warn({ invoiceId, orderId, status: payment.status }, 'CryptoBot payment is already terminal; refusing settlement')
    return false
  }
  const expectedCents = Number(payment.amount)
  if (!Number.isSafeInteger(expectedCents) || expectedCents !== amountCents) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.UNDERPAID, rawPayload }
    })
    logger.error(
      { invoiceId, orderId, expectedCents, receivedCents: amountCents },
      'CryptoBot payment amount does not match the order'
    )
    return false
  }
  const updated = await prisma.payment.updateMany({
    where: { id: payment.id, status: { not: PaymentStatus.PAID } },
    data: { status: PaymentStatus.PAID, rawPayload }
  })
  if (updated.count === 0) {
    const current = await prisma.payment.findUnique({ where: { id: payment.id } })
    return current?.status === PaymentStatus.PAID && current.orderId === orderId
  }

  await emitPaymentReceived(payment)
  return true
}

/** CryptoBot sends fiat invoice amounts as decimal strings; parse without floats. */
function parseUsdCents(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null
  const [wholePart = '0', fractionPart = ''] = value.split('.')
  const whole = Number(wholePart)
  const cents = Number(fractionPart.padEnd(2, '0'))
  const result = whole * 100 + cents
  return Number.isSafeInteger(result) ? result : null
}

export function registerCryptoBotWebhookRoute(app: FastifyInstance): void {
  app.post('/webhook/cryptobot', async (req, reply) => {
    const signature = req.headers['crypto-pay-api-signature']
    if (typeof signature !== 'string' || !req.rawBody) {
      await reply.code(400).send({ error: 'missing signature or body' })
      return
    }

    if (!verifyCryptoBotSignature(req.rawBody, signature)) {
      await reply.code(401).send({ error: 'invalid signature' })
      return
    }

    const parsed = cryptoBotWebhookSchema.safeParse(req.body)
    if (!parsed.success) {
      await reply.code(400).send({ error: 'malformed webhook body' })
      return
    }

    const idempotencyKey = `cryptobot-webhook:${parsed.data.payload.invoice_id}`
    const already = await prisma.idempotencyRecord.findUnique({ where: { key: idempotencyKey } })
    if (already) {
      await reply.code(200).send({ ok: true, deduped: true })
      return
    }

    const orderOrTopupRef = parsed.data.payload.payload
    const invoiceId = String(parsed.data.payload.invoice_id)

    try {
      if (parsed.data.payload.status === 'paid') {
        if (orderOrTopupRef?.startsWith('topup_')) {
          // The Payment row was written at invoice-creation time and carries the
          // real payer. If it is missing we must NOT invent a userId: Payment.userId
          // is a required FK, so a placeholder throws and CryptoBot then retries a
          // genuinely-paid invoice forever. Acknowledge, and alert instead.
          const existing = await findTopupPayment(invoiceId, orderOrTopupRef)
          if (!existing) {
            logger.error(
              { invoiceId, reference: orderOrTopupRef, amount: parsed.data.payload.amount },
              'PAID top-up has no originating Payment row — manual credit required'
            )
          } else {
            if (existing.status === PaymentStatus.PAID) {
              // A duplicate webhook must not downgrade an already settled row
              // merely because a provider payload was replayed differently.
              logger.debug({ invoiceId, paymentId: existing.id }, 'CryptoBot top-up already settled')
            } else {
              const amountCents = parseUsdCents(parsed.data.payload.amount)
              const expectedCents = Number(existing.amount)
              if (amountCents === null || !Number.isSafeInteger(expectedCents) || amountCents !== expectedCents) {
                await prisma.payment.update({
                  where: { id: existing.id },
                  data: { status: PaymentStatus.UNDERPAID, rawPayload: req.body as object }
                })
                logger.error(
                  { invoiceId, reference: orderOrTopupRef, expectedCents, receivedCents: amountCents },
                  'CryptoBot top-up amount does not match the requested amount'
                )
              } else {
                const settled = await settleCryptoBotTopup(existing, invoiceId, amountCents, req.body as object)
                if (settled.claimed) await emitPaymentReceived(existing)
              }
            }
          }
        } else if (orderOrTopupRef) {
          // Settle the Payment row before touching the order. Money has arrived
          // whatever delivery does next. payments-poll would eventually settle a
          // row left PENDING here, but 30s later and only because the sweep now
          // re-checks every pending payment — the webhook is the primary path
          // and must not lean on its own fallback.
          const amountCents = parseUsdCents(parsed.data.payload.amount)
          if (amountCents === null) {
            logger.error({ invoiceId, orderId: orderOrTopupRef }, 'CryptoBot order amount is not valid USD cents')
          } else if (await settleOrderPayment(invoiceId, orderOrTopupRef, amountCents, req.body as object)) {
            try {
              await markOrderPaidAndDeliver(orderOrTopupRef)
            } catch (err) {
            // The payment is real and the order has already been settled by
            // domain/orders.ts — a delivery-side domain failure (empty pool,
            // dead supplier) marks it FAILED and refunds the buyer before it
            // reaches here. Answering 500 would make CryptoBot redeliver this
            // webhook forever for an order that can never succeed, and the
            // retry would then hit an illegal FAILED -> PAID transition. So
            // acknowledge and alert; only unexpected (non-domain) faults, which
            // a retry genuinely might clear, are still allowed to 500.
              if (!(err instanceof DomainError)) throw err
              logger.error(
                { err, invoiceId, orderId: orderOrTopupRef },
                'paid order could not be delivered; already settled and refunded'
              )
            }
          }
        }
      }

      await prisma.idempotencyRecord.upsert({
        where: { key: idempotencyKey },
        create: { key: idempotencyKey, scope: 'cryptobot-webhook', resultJson: { processed: true } },
        update: {}
      })
      await reply.code(200).send({ ok: true })
    } catch (err) {
      logger.error({ err, invoiceId }, 'failed to process CryptoBot webhook')
      await reply.code(500).send({ ok: false })
    }
  })
}
