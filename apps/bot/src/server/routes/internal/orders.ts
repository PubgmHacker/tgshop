import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma, OrderStatus, PaymentProvider, type Prisma } from '@tgshop/db'
import { sendError } from '../../../lib/httpErrors.js'
import { internalLocale } from './context.js'

// ─────────────────────────────────────────────────────────────────────────────
// GET /internal/orders?status=&provider=&limit=&cursor=
//
// Operational order feed for the worker, admin tooling and agents. Deliberately
// never returns deliveredPayloadEnc or any decrypted payload — secrets belong
// only to the buying user's own /api/orders/:id response.
// ─────────────────────────────────────────────────────────────────────────────

const listQuerySchema = z.object({
  status: z.nativeEnum(OrderStatus).optional(),
  provider: z.nativeEnum(PaymentProvider).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** Order id to page after, newest-first. */
  cursor: z.string().min(1).max(64).optional()
})

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
}
