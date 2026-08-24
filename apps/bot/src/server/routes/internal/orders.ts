import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma, OrderStatus, PaymentProvider, type Prisma } from '@tgshop/db'
import { getSetting, refundOrder, refundedCentsFor } from '@tgshop/core'
import { redis } from '../../../config/redis.js'
import { emitEvent } from '../../../domain/events.js'
import { notFound, sendError } from '../../../lib/httpErrors.js'
import { internalLocale } from './context.js'

// ─────────────────────────────────────────────────────────────────────────────
// GET  /internal/orders?status=&provider=&limit=&cursor=
// POST /internal/orders/:id/refund
//
// The order feed is operational data for the worker, admin tooling and agents.
// It deliberately never returns deliveredPayloadEnc or any decrypted payload —
// secrets belong only to the buying user's own /api/orders/:id response.
//
// The refund endpoint is the gated write from docs/AGENT_PLAN.md: at or below
// the refund_auto_approve_ceiling_cents Setting it refunds through core's
// refundOrder() (state machine, stock release, promo return, idempotent ledger
// credit — all enforced there); above it, it only records a pending-approval
// audit entry for a human ADMIN to act on from the panel.
// ─────────────────────────────────────────────────────────────────────────────

const listQuerySchema = z.object({
  status: z.nativeEnum(OrderStatus).optional(),
  provider: z.nativeEnum(PaymentProvider).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** Order id to page after, newest-first. */
  cursor: z.string().min(1).max(64).optional()
})

const refundParamsSchema = z.object({
  id: z.string().min(1).max(64)
})

const refundBodySchema = z.object({
  reason: z.string().min(1).max(500),
  /** Who is asking; kept on the audit trail. Defaults to the anonymous service identity. */
  source: z.string().min(1).max(64).default('internal-api')
})

const REFUND_REQUESTED_ACTION = 'order.refund_requested'

export function registerInternalOrderRoutes(app: FastifyInstance): void {
  app.get('/internal/orders', async (req, reply) => {
    try {
      const query = listQuerySchema.parse(req.query)

      const where: Prisma.OrderWhereInput = {}
      if (query.status) where.status = query.status
      if (query.provider) where.provider = query.provider

      const orders = await prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: query.limit,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        include: {
          plan: { include: { product: true } },
          user: { select: { id: true, tgId: true, username: true } }
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
          planId: order.planId,
          planTitle: order.plan.title,
          productTitle: order.plan.product.title,
          deliveryType: order.plan.product.deliveryType,
          user: {
            id: order.user.id,
            tgId: order.user.tgId.toString(),
            username: order.user.username
          },
          createdAt: order.createdAt.toISOString(),
          paidAt: order.paidAt ? order.paidAt.toISOString() : null,
          deliveredAt: order.deliveredAt ? order.deliveredAt.toISOString() : null,
          expiresAt: order.expiresAt ? order.expiresAt.toISOString() : null,
          isDelivered: order.deliveredPayloadEnc !== null
        })),
        nextCursor: orders.length === query.limit ? (orders[orders.length - 1]?.id ?? null) : null
      }
    } catch (err) {
      await sendError(reply, err, internalLocale())
      return
    }
  })

  app.post('/internal/orders/:id/refund', async (req, reply) => {
    try {
      const { id: orderId } = refundParamsSchema.parse(req.params)
      const body = refundBodySchema.parse(req.body)

      const order = await prisma.order.findUnique({ where: { id: orderId } })
      if (!order) throw notFound('api.errors.order_not_found')

      // An agent retrying a timed-out call must see success, not ORDER_STATE, and
      // must never trigger a second payout. Gate on any REFUND already booked for
      // this order — not just status === REFUNDED — because a failed delivery
      // auto-refunds the buyer while leaving the order FAILED, so status alone
      // would let an already-refunded order fall through to another refund (or, if
      // above the ceiling, needlessly ask a human to approve one that happened).
      const priorRefundCents = await refundedCentsFor(prisma, orderId)
      if (order.status === OrderStatus.REFUNDED || priorRefundCents > 0) {
        return {
          status: 'REFUNDED',
          alreadyRefunded: true,
          orderId,
          refundedCents: priorRefundCents
        }
      }

      const ceilingCents = await getSetting(prisma, 'refund_auto_approve_ceiling_cents', redis)

      if (order.amountCents > ceilingCents) {
        // Above the ceiling: record the request for a human, mutate nothing.
        // One open request per order — a retry storm must not bury the admin
        // audit timeline under identical entries.
        const alreadyPending = await prisma.auditLog.findFirst({
          where: { action: REFUND_REQUESTED_ACTION, entity: 'Order', entityId: orderId },
          orderBy: { createdAt: 'desc' }
        })

        if (!alreadyPending) {
          await prisma.auditLog.create({
            data: {
              actorType: 'agent',
              actorId: body.source,
              action: REFUND_REQUESTED_ACTION,
              entity: 'Order',
              entityId: orderId,
              diff: { reason: body.reason, amountCents: order.amountCents, ceilingCents }
            }
          })
        }

        reply.code(202)
        return {
          status: 'PENDING_APPROVAL',
          orderId,
          amountCents: order.amountCents,
          ceilingCents,
          alreadyPending: alreadyPending !== null
        }
      }

      // At or below the ceiling: refund now. core's refundOrder() enforces the
      // state machine (409 via the OrderStateError mapping when illegal) and
      // writes its own system audit row; the extra row below records WHO asked.
      await prisma.$transaction((tx) => refundOrder(tx, orderId, body.reason))

      await prisma.auditLog.create({
        data: {
          actorType: 'agent',
          actorId: body.source,
          action: 'order.refund',
          entity: 'Order',
          entityId: orderId,
          diff: { reason: body.reason, amountCents: order.amountCents, ceilingCents }
        }
      })

      // After commit, never inside the transaction (domain/events.ts contract).
      await emitEvent('order.refunded', {
        orderId,
        userId: order.userId,
        planId: order.planId,
        refundedCents: order.amountCents,
        reason: body.reason,
        refundedBy: 'agent'
      })

      return {
        status: 'REFUNDED',
        alreadyRefunded: false,
        orderId,
        refundedCents: order.amountCents
      }
    } catch (err) {
      await sendError(reply, err, internalLocale())
      return
    }
  })
}
