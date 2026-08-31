import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma, PaymentProvider } from '@tgshop/db'
import { computeOrderTotal } from '@tgshop/core'
import {
  createOrder,
  getOrderById,
  payOrderFromBalance,
  creditReferralBonusIfEligible
} from '../../../domain/orders.js'
import { getPlanById } from '../../../domain/catalog.js'
import { countAvailableForPlan, isPoolBacked } from '../../../domain/stock.js'
import { createInvoice, getLatestPaymentForOrder } from '../../../domain/payments.js'
import { getUserBalance } from '../../../domain/users.js'
import { HttpError, badRequest, conflict, forbidden, notFound, sendError, unavailable } from '../../../lib/httpErrors.js'
import { logger } from '../../../lib/logger.js'
import { requestLocale, requireUserId } from './context.js'
import { toOrderDetailDto } from './presenters.js'
import { planPriceToStars } from '../../../payments/stars.js'
import { isPaymentProviderAvailable } from '../../../domain/payment-availability.js'

// ─────────────────────────────────────────────────────────────────────────────
// Order creation, payment kickoff, and status polling.
//
// BALANCE settles synchronously (debit + deliver) so the Mini App can show the
// payload immediately. CRYPTOBOT / STARS / TRON_TRC20 create a Payment and
// return payment instructions; settlement arrives later via webhook (CryptoBot),
// the bot's successful_payment handler (Stars), or the worker's chain scanner
// (TRON), and the client polls GET /api/orders/:id until the status is terminal.
// ─────────────────────────────────────────────────────────────────────────────

const providerSchema = z.enum(['BALANCE', 'CRYPTOBOT', 'STARS', 'TRON_TRC20'])

const createOrderBodySchema = z.object({
  planId: z.string().min(1).max(64),
  qty: z.number().int().min(1).max(99),
  promoCode: z.string().min(1).max(64).nullish(),
  provider: providerSchema,
  idempotencyKey: z.string().min(8).max(128)
})

const pricingPreviewBodySchema = z.object({
  planId: z.string().min(1).max(64),
  qty: z.number().int().min(1).max(99),
  promoCode: z.string().min(1).max(64).nullish()
})

const orderIdParamSchema = z.object({
  id: z.string().min(1).max(64)
})

export function registerOrderRoutes(app: FastifyInstance): void {
  // POST /api/pricing/preview — live total for the buy sheet (promo validation).
  app.post('/api/pricing/preview', async (req, reply) => {
    try {
      const body = pricingPreviewBodySchema.parse(req.body)
      requireUserId(req)

      const plan = await prisma.plan.findUnique({ where: { id: body.planId } })
      if (!plan || !plan.isActive) throw notFound('api.errors.plan_not_found')

      const promo = body.promoCode
        ? await prisma.promo.findUnique({ where: { code: body.promoCode.toUpperCase() } })
        : null
      if (body.promoCode && !promo) {
        throw badRequest('api.errors.promo_invalid')
      }

      // computeOrderTotal validates the promo (active/expiry/uses/plan scope)
      // and throws PromoInvalidError, which maps to a 400 for the buy sheet.
      return computeOrderTotal(plan, body.qty, promo)
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })

  // POST /api/orders — create the order and start (or complete) payment.
  app.post('/api/orders', async (req, reply) => {
    const locale = requestLocale(req)
    try {
      const body = createOrderBodySchema.parse(req.body)
      const userId = requireUserId(req)
      const provider = PaymentProvider[body.provider]
      const idempotencyKey = `order:${userId}:${body.idempotencyKey}`

      // Check the namespaced key before stock/config validation. A retry must
      // return the original order even if the last stock item has since gone or
      // an operator temporarily disabled that payment rail.
      const existingOrder = await prisma.order.findUnique({ where: { idempotencyKey } })
      if (!existingOrder && !isPaymentProviderAvailable(provider)) {
        throw unavailable()
      }

      const plan = await getPlanById(existingOrder?.planId ?? body.planId)
      if (!plan) throw notFound('api.errors.plan_not_found')

      if (!existingOrder && (!plan.isActive || !plan.product.isActive)) {
        throw notFound('api.errors.plan_not_found')
      }

      // Reject before taking money when the pool is already empty. externalConfig
      // is passed so a UNIQUE_CODE product that mints codes from a template is
      // not mistaken for a finite pool and refused as "sold out".
      if (!existingOrder && isPoolBacked(plan.product.deliveryType, plan.product.externalConfig)) {
        const available = await countAvailableForPlan(plan.id)
        if (available < body.qty) {
          throw new HttpError(409, 'STOCK_UNAVAILABLE', 'api.errors.stock_unavailable')
        }
      }

      const { order, pricing } = await createOrder({
        userId,
        planId: plan.id,
        qty: body.qty,
        provider,
        promoCode: body.promoCode ?? null,
        // Namespaced by user so one client cannot collide with (or replay)
        // another user's key on the globally-unique Order.idempotencyKey.
        idempotencyKey
      })

      // A replayed idempotencyKey returns the original order; make sure it is
      // still this caller's order before echoing any of it back.
      if (order.userId !== userId) throw forbidden()
      if (order.planId !== body.planId || order.qty !== body.qty) {
        throw conflict('api.errors.idempotency_conflict')
      }
      // A client retry must never create a second invoice after the original
      // order has already settled. Also reject a reused key with a different
      // payment rail instead of attaching a new provider payment to history.
      if (order.provider !== provider) throw conflict('api.errors.idempotency_conflict')
      if (order.status !== 'PENDING') {
        return { orderId: order.id, status: order.status, pricing }
      }

      if (!isPaymentProviderAvailable(provider)) throw unavailable()

      if (provider === PaymentProvider.BALANCE) {
        const balance = await getUserBalance(userId)
        if (balance < pricing.totalCents) {
          throw new HttpError(402, 'INSUFFICIENT_BALANCE', 'api.errors.insufficient_balance')
        }

        const paid = await payOrderFromBalance(order)
        void creditReferralBonusIfEligible(paid).catch((err: unknown) =>
          logger.error({ err, orderId: paid.id }, 'failed to credit referral bonus')
        )

        return { orderId: paid.id, status: paid.status, pricing }
      }

      const invoice = await createInvoice({
        userId,
        amountCents: pricing.totalCents,
        provider,
        description: `${plan.product.title} — ${plan.title}`,
        reference: order.id,
        orderId: order.id,
        priceStars: planPriceToStars(plan.priceStars, plan.priceCents, body.qty, pricing.totalCents)
      })

      return {
        orderId: order.id,
        status: order.status,
        pricing,
        payUrl: invoice.payUrl,
        stars: invoice.stars,
        tron: invoice.tron
      }
    } catch (err) {
      await sendError(reply, err, locale)
      return
    }
  })

  // GET /api/orders/:id — checkout polling. Owner-only.
  app.get('/api/orders/:id', async (req, reply) => {
    try {
      const { id } = orderIdParamSchema.parse(req.params)
      const userId = requireUserId(req)

      const order = await getOrderById(id)
      if (!order) throw notFound('api.errors.order_not_found')
      // Ownership check, not just existence: order ids must not be enumerable
      // into other users' delivered payloads.
      if (order.userId !== userId) throw notFound('api.errors.order_not_found')

      const payment = await getLatestPaymentForOrder(order.id)
      return toOrderDetailDto(order, payment)
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })
}
