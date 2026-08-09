import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { PaymentProvider } from '@tgshop/db'
import { createInvoice } from '../../../domain/payments.js'
import { newTopupReference } from '../../../domain/topup.js'
import { sendError } from '../../../lib/httpErrors.js'
import { requestLocale, requireUserId } from './context.js'

// ─────────────────────────────────────────────────────────────────────────────
// Balance top-ups. Same payment pipeline as orders, minus the plan/delivery
// half: the credit itself is applied when the provider confirms (CryptoBot
// webhook / Stars successful_payment / worker chain scan), never here.
//
// BALANCE is deliberately not a top-up method (it would be a no-op transfer).
// ─────────────────────────────────────────────────────────────────────────────

const MIN_TOPUP_CENTS = 100
const MAX_TOPUP_CENTS = 1_000_000

const topupBodySchema = z.object({
  amountCents: z.number().int().min(MIN_TOPUP_CENTS).max(MAX_TOPUP_CENTS),
  method: z.enum(['CRYPTOBOT', 'STARS', 'TRON_TRC20']),
  idempotencyKey: z.string().min(8).max(128)
})

async function createTopup(req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  try {
    const body = topupBodySchema.parse(req.body)
    const userId = requireUserId(req)

    const provider = PaymentProvider[body.method]
    const reference = newTopupReference()

    const invoice = await createInvoice({
      userId,
      amountCents: body.amountCents,
      provider,
      description: `Balance top-up ${(body.amountCents / 100).toFixed(2)} USD`,
      reference,
      // Top-ups are not tied to an order; TRON therefore cannot allocate a
      // per-order deposit address and will surface a clear error instead.
      orderId: null
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
