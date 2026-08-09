import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma, PaymentStatus } from '@tgshop/db'
import { DomainError } from '@tgshop/core'
import { verifyCryptoBotSignature } from '../../payments/cryptobot.js'
import { creditTopup, findTopupPayment } from '../../domain/topup.js'
import { markOrderPaidAndDeliver } from '../../domain/orders.js'
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
          }
        } else if (orderOrTopupRef) {
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
