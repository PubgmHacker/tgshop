import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { Api } from 'grammy'
import { prisma, OrderStatus, PaymentProvider, type Prisma } from '@tgshop/db'
import { deliverManualOrder, refundOrder, refundedCentsFor } from '@tgshop/core'
import { emitEvent } from '../../../../domain/events.js'
import { conflict, notFound, sendError } from '../../../../lib/httpErrors.js'
import { requestLocale } from '../context.js'
import { writeAdminAudit } from './shared.js'
import { env } from '../../../../config/env.js'
import { resolveLocale } from '../../../../i18n/index.js'
import { logger } from '../../../../lib/logger.js'

// ─────────────────────────────────────────────────────────────────────────────
// GET  /api/admin/orders            — filterable, cursor-paginated feed
// GET  /api/admin/orders/:id        — full detail (payments + ledger, no secrets)
// POST /api/admin/orders/:id/manual-deliver — finish a manual-fallback order
// POST /api/admin/orders/:id/refund — direct refund; the admin IS the human
//                                     approver, so no auto-approve ceiling here.
//
// Like /internal/orders, this NEVER returns deliveredPayloadEnc or a decrypted
// payload — delivered goods belong only to the buyer's own /api/orders/:id.
// ─────────────────────────────────────────────────────────────────────────────

const listQuerySchema = z.object({
  status: z.nativeEnum(OrderStatus).optional(),
  provider: z.nativeEnum(PaymentProvider).optional(),
  /** Order id, user tgId (digits) or username fragment. */
  q: z.string().trim().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().min(1).max(64).optional()
})

const idParamsSchema = z.object({ id: z.string().min(1).max(64) })

const refundBodySchema = z.object({
  reason: z.string().trim().min(1).max(500)
})

const manualDeliveryBodySchema = z.object({
  payload: z.string().trim().min(1).max(10_000)
})

let telegramApi: Api | null = null

function getTelegramApi(): Api {
  if (!telegramApi) telegramApi = new Api(env.BOT_TOKEN)
  return telegramApi
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function notifyBuyerAfterManualDelivery(
  tgId: bigint,
  languageCode: string | null,
  orderId: string,
  payload: string
): Promise<boolean> {
  try {
    const locale = resolveLocale(languageCode)
    const caption =
      locale === 'ru' ? `✅ Заказ #${orderId} выдан:` : `✅ Order #${orderId} has been delivered:`
    const footer =
      locale === 'ru'
        ? '\n\nСохраните эти данные. Если сообщение потерялось, откройте заказ в разделе «Покупки».'
        : '\n\nSave these details. If the message gets lost, open the order from Purchases.'
    await getTelegramApi().sendMessage(
      tgId.toString(),
      `${caption}\n\n<span class="tg-spoiler"><code>${escapeHtml(payload)}</code></span>${footer}`,
      { parse_mode: 'HTML' }
    )
    return true
  } catch (err) {
    logger.warn({ err, orderId }, 'manual delivery committed but buyer notification failed')
    return false
  }
}

function searchWhere(q: string): Prisma.OrderWhereInput {
  const or: Prisma.OrderWhereInput[] = [{ id: q }]
  if (/^\d{4,}$/.test(q)) {
    or.push({ user: { tgId: BigInt(q) } })
  } else {
    or.push({ user: { username: { contains: q, mode: 'insensitive' } } })
  }
  return { OR: or }
}

export function registerAdminOrderRoutes(app: FastifyInstance): void {
  app.get('/api/admin/orders', async (req, reply) => {
    try {
      const query = listQuerySchema.parse(req.query)

      const where: Prisma.OrderWhereInput = {
        ...(query.q ? searchWhere(query.q) : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.provider ? { provider: query.provider } : {})
      }

      const orders = await prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: query.limit,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        include: {
          plan: { select: { title: true, product: { select: { title: true } } } },
          user: { select: { id: true, tgId: true, username: true, firstName: true } },
          promo: { select: { code: true } }
        }
      })

      return {
        orders: orders.map((order) => ({
          id: order.id,
          status: order.status,
          provider: order.provider,
          amountCents: order.amountCents,
          currency: order.currency,
          qty: order.qty,
          planTitle: order.plan.title,
          productTitle: order.plan.product.title,
          promoCode: order.promo?.code ?? null,
          user: {
            id: order.user.id,
            tgId: order.user.tgId.toString(),
            username: order.user.username,
            firstName: order.user.firstName
          },
          createdAt: order.createdAt.toISOString(),
          paidAt: order.paidAt ? order.paidAt.toISOString() : null,
          isDelivered: order.deliveredPayloadEnc !== null
        })),
        nextCursor: orders.length === query.limit ? (orders[orders.length - 1]?.id ?? null) : null
      }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })

  app.get('/api/admin/orders/:id', async (req, reply) => {
    try {
      const { id } = idParamsSchema.parse(req.params)

      const order = await prisma.order.findUnique({
        where: { id },
        include: {
          plan: {
            select: {
              id: true,
              title: true,
              product: { select: { id: true, title: true, deliveryType: true } }
            }
          },
          user: { select: { id: true, tgId: true, username: true, firstName: true } },
          promo: { select: { code: true } },
          payments: { orderBy: { createdAt: 'desc' } },
          ledgerEntries: { orderBy: { createdAt: 'desc' } }
        }
      })
      if (!order) throw notFound('api.errors.order_not_found')

      const refundedCents = await refundedCentsFor(prisma, order.id)

      return {
        order: {
          id: order.id,
          status: order.status,
          provider: order.provider,
          amountCents: order.amountCents,
          currency: order.currency,
          qty: order.qty,
          planId: order.plan.id,
          planTitle: order.plan.title,
          productId: order.plan.product.id,
          productTitle: order.plan.product.title,
          deliveryType: order.plan.product.deliveryType,
          customerEmail: order.customerEmail,
          promoCode: order.promo?.code ?? null,
          user: {
            id: order.user.id,
            tgId: order.user.tgId.toString(),
            username: order.user.username,
            firstName: order.user.firstName
          },
          createdAt: order.createdAt.toISOString(),
          paidAt: order.paidAt ? order.paidAt.toISOString() : null,
          deliveredAt: order.deliveredAt ? order.deliveredAt.toISOString() : null,
          expiresAt: order.expiresAt ? order.expiresAt.toISOString() : null,
          isDelivered: order.deliveredPayloadEnc !== null,
          refundedCents
        },
        payments: order.payments.map((p) => ({
          id: p.id,
          provider: p.provider,
          status: p.status,
          amount: p.amount.toString(),
          asset: p.asset,
          network: p.network,
          txHash: p.txHash,
          createdAt: p.createdAt.toISOString()
        })),
        ledger: order.ledgerEntries.map((entry) => ({
          id: entry.id,
          type: entry.type,
          amountCents: entry.amountCents,
          comment: entry.comment,
          createdAt: entry.createdAt.toISOString()
        }))
      }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })

  app.post('/api/admin/orders/:id/manual-deliver', async (req, reply) => {
    try {
      const { id: orderId } = idParamsSchema.parse(req.params)
      const body = manualDeliveryBodySchema.parse(req.body)

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { stockItem: true, user: true, plan: { include: { product: true } } }
      })
      if (!order) throw notFound('api.errors.order_not_found')

      // Manual delivery is only safe for a paid/manual order that does not
      // already own a payload or a stock item. Otherwise an operator could
      // accidentally overwrite a credential or strand it in the pool.
      const canDeliverManually =
        order.plan.product.deliveryType === 'MANUAL_FALLBACK' &&
        (order.status === OrderStatus.PAID || order.status === OrderStatus.DELIVERING) &&
        order.deliveredPayloadEnc === null &&
        order.stockItem === null
      if (!canDeliverManually) {
        throw conflict('api.errors.manual_delivery_unavailable')
      }

      const delivered = await deliverManualOrder(prisma, orderId, body.payload)

      // The delivery transaction is the source of truth. Audit/event writes are
      // post-commit observability and must not turn a successful delivery into a
      // 500 that makes the operator retry a secret-bearing action.
      await writeAdminAudit(req, 'order.manual_deliver', 'Order', orderId, {
        payloadLength: body.payload.trim().length,
        customerEmail: order.customerEmail
      }).catch((err) => logger.error({ err, orderId }, 'manual delivery audit write failed'))
      await emitEvent('order.delivered', {
        orderId,
        userId: order.userId,
        planId: order.planId,
        deliveredAt: (delivered.deliveredAt ?? new Date()).toISOString()
      }).catch((err) => logger.error({ err, orderId }, 'manual delivery event publish failed'))

      const buyerNotified = await notifyBuyerAfterManualDelivery(
        order.user.tgId,
        order.user.languageCode,
        orderId,
        body.payload.trim()
      )

      reply.code(201)
      return { orderId, status: 'DELIVERED', buyerNotified }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })

  app.post('/api/admin/orders/:id/refund', async (req, reply) => {
    try {
      const { id: orderId } = idParamsSchema.parse(req.params)
      const body = refundBodySchema.parse(req.body)

      const order = await prisma.order.findUnique({ where: { id: orderId } })
      if (!order) throw notFound('api.errors.order_not_found')

      // Same idempotency posture as /internal: a retry of a timed-out call must
      // see success, not ORDER_STATE, and never pay twice. Gate on any REFUND
      // already booked — not just status — because a failed delivery auto-refunds
      // while leaving the order FAILED.
      const priorRefundCents = await refundedCentsFor(prisma, orderId)
      if (order.status === OrderStatus.REFUNDED || priorRefundCents > 0) {
        return {
          status: 'REFUNDED',
          alreadyRefunded: true,
          orderId,
          refundedCents: priorRefundCents
        }
      }

      await prisma.$transaction((tx) => refundOrder(tx, orderId, body.reason))

      await writeAdminAudit(req, 'order.refund', 'Order', orderId, {
        reason: body.reason,
        amountCents: order.amountCents
      })

      // After commit, never inside the transaction (domain/events.ts contract).
      await emitEvent('order.refunded', {
        orderId,
        userId: order.userId,
        planId: order.planId,
        refundedCents: order.amountCents,
        reason: body.reason,
        refundedBy: 'admin'
      })

      return {
        status: 'REFUNDED',
        alreadyRefunded: false,
        orderId,
        refundedCents: order.amountCents
      }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })
}
