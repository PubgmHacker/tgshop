import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma, PaymentProvider, PaymentStatus } from '@tgshop/db'
import { DomainError } from '@tgshop/core'
import { verifyCryptoBotSignature } from '../../payments/cryptobot.js'
import { creditTopup, findTopupPayment } from '../../domain/topup.js'
import { markOrderPaidAndDeliver } from '../../domain/orders.js'
import { emitEvent } from '../../domain/events.js'
import { logger } from '../../lib/logger.js'

const cryptoBotWebhookSchema = z.object({
  update_type: z.string(),
  payload: z.object({
    invoice_id: z.number(),
    status: z.string(),
    amount: z.string(),
    asset: z.string(),
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
  rawPayload: object
): Promise<void> {
  const payment = await prisma.payment.findUnique({
    where: {
      provider_providerInvoiceId: { provider: PaymentProvider.CRYPTOBOT, providerInvoiceId: invoiceId }
    }
  })
  if (!payment) {
    logger.error({ invoiceId, orderId }, 'PAID CryptoBot invoice has no Payment row — order settles without one')
    return
  }
  if (payment.status === PaymentStatus.PAID) return

  const updated = await prisma.payment.updateMany({
    where: { id: payment.id, status: { not: PaymentStatus.PAID } },
    data: { status: PaymentStatus.PAID, rawPayload }
  })
  if (updated.count === 0) return

  await emitPaymentReceived(payment)
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
            const payment = await prisma.payment.update({
              where: { id: existing.id },
              data: {
                providerInvoiceId: invoiceId,
                status: PaymentStatus.PAID,
                rawPayload: req.body as object
              }
            })
            const amountCents = Math.round(Number.parseFloat(parsed.data.payload.amount) * 100)
            await creditTopup(payment.userId, amountCents, payment.id)
            await emitPaymentReceived(payment)
          }
        } else if (orderOrTopupRef) {
          // Settle the Payment row before touching the order. Money has arrived
          // whatever delivery does next. payments-poll would eventually settle a
          // row left PENDING here, but 30s later and only because the sweep now
          // re-checks every pending payment — the webhook is the primary path
          // and must not lean on its own fallback.
          await settleOrderPayment(invoiceId, orderOrTopupRef, req.body as object)

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

      await prisma.idempotencyRecord.create({
        data: { key: idempotencyKey, scope: 'cryptobot-webhook', resultJson: { processed: true } }
      })
      await reply.code(200).send({ ok: true })
    } catch (err) {
      logger.error({ err, invoiceId }, 'failed to process CryptoBot webhook')
      await reply.code(500).send({ ok: false })
    }
  })
}
