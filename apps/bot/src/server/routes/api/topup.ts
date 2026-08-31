import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { PaymentProvider } from '@tgshop/db'
import { createInvoice } from '../../../domain/payments.js'
import { newTopupReference } from '../../../domain/topup.js'
import { getTopupLimits } from '../../../domain/topup-policy.js'
import { isTopupProviderAvailable } from '../../../domain/payment-availability.js'
import { formatUsd } from '../../../lib/format.js'
import { badRequest, sendError, unavailable } from '../../../lib/httpErrors.js'
import { requestLocale, requireUserId } from './context.js'

// ─────────────────────────────────────────────────────────────────────────────
// Balance top-ups. Same payment pipeline as orders, minus the plan/delivery
// half: the credit itself is applied when the provider confirms (CryptoBot
// webhook / Stars successful_payment / worker chain scan), never here.
//
// BALANCE is deliberately not a top-up method (it would be a no-op transfer).
// ─────────────────────────────────────────────────────────────────────────────

const topupBodySchema = z.object({
  amountCents: z.number().int().positive(),
  method: z.enum(['CRYPTOBOT', 'STARS', 'TRON_TRC20']),
  idempotencyKey: z.string().min(8).max(128)
})

async function createTopup(req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  try {
    const body = topupBodySchema.parse(req.body)
    const userId = requireUserId(req)
    const limits = await getTopupLimits()
    if (body.amountCents < limits.minCents || body.amountCents > limits.maxCents) {
      throw badRequest('api.errors.topup_amount_invalid', {
        min: formatUsd(limits.minCents),
        max: formatUsd(limits.maxCents)
      })
    }

    const provider = PaymentProvider[body.method]
    if (!isTopupProviderAvailable(body.method)) throw unavailable()
    const reference = newTopupReference()

    const invoice = await createInvoice({
      userId,
      amountCents: body.amountCents,
      provider,
      description: `Balance top-up ${(body.amountCents / 100).toFixed(2)} USD`,
      reference,
      // Top-ups are not tied to an order; TRON therefore cannot allocate a
      // per-order deposit address and will surface a clear error instead.
      orderId: null,
      idempotencyKey: body.idempotencyKey
    })

    return {
      paymentId: invoice.payment.id,
      provider: invoice.payment.provider,
      status: invoice.payment.status,
      redirectUrl: invoice.payUrl,
      tron: invoice.tron
    }
  } catch (err) {
    await sendError(reply, err, requestLocale(req))
    return
  }
}

export function registerTopupRoutes(app: FastifyInstance): void {
  // The Mini App posts to /api/topups; /api/topup is accepted as an alias so
  // either spelling works against the same pipeline.
  app.post('/api/topups', createTopup)
  app.post('/api/topup', createTopup)
}
