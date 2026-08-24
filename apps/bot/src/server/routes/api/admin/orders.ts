import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma, OrderStatus, PaymentProvider, type Prisma } from '@tgshop/db'
import { refundOrder, refundedCentsFor } from '@tgshop/core'
import { emitEvent } from '../../../../domain/events.js'
import { notFound, sendError } from '../../../../lib/httpErrors.js'
import { requestLocale } from '../context.js'
import { writeAdminAudit } from './shared.js'

// ─────────────────────────────────────────────────────────────────────────────
// GET  /api/admin/orders            — filterable, cursor-paginated feed
// GET  /api/admin/orders/:id        — full detail (payments + ledger, no secrets)
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
          plan: { select: { id: true, title: true, product: { select: { id: true, title: true } } } },
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
        return { status: 'REFUNDED', alreadyRefunded: true, orderId, refundedCents: priorRefundCents }
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

      return { status: 'REFUNDED', alreadyRefunded: false, orderId, refundedCents: order.amountCents }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })
}
