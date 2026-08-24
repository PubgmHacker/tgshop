import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma, LedgerType, type Prisma } from '@tgshop/db'
import { credit, debit, getBalance } from '@tgshop/core'
import { isAdminId } from '../../../../config/env.js'
import { conflict, notFound, sendError } from '../../../../lib/httpErrors.js'
import { requestLocale } from '../context.js'
import { writeAdminAudit } from './shared.js'

// ─────────────────────────────────────────────────────────────────────────────
// GET  /api/admin/users            — search / cursor-paginated list
// GET  /api/admin/users/:id        — profile: balance, totals, orders, ledger
// POST /api/admin/users/:id/balance — ADMIN_ADJUST credit/debit
// POST /api/admin/users/:id/block   — ban / unban
//
// Balance adjustments REQUIRE a client-supplied idempotencyKey: a retried
// request (timeout, flaky network) must resolve to the one ledger entry it
// already wrote, never a second one. The ledger enforces that per key.
// ─────────────────────────────────────────────────────────────────────────────

const idParamsSchema = z.object({ id: z.string().min(1).max(64) })

const listQuerySchema = z.object({
  /** tgId (digits) or username/first-name fragment. */
  q: z.string().trim().min(1).max(64).optional(),
  blocked: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().min(1).max(64).optional()
})

const balanceBodySchema = z.object({
  /** Positive credits, negative debits. Integer cents, never zero. */
  amountCents: z
    .number()
    .int()
    .min(-100_000_000)
    .max(100_000_000)
    .refine((v) => v !== 0, 'amount must not be zero'),
  comment: z.string().trim().min(1).max(200),
  idempotencyKey: z.string().trim().min(8).max(100)
})

const blockBodySchema = z.object({
  blocked: z.boolean()
})

function userListWhere(query: z.infer<typeof listQuerySchema>): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = {}
  if (query.blocked !== undefined) where.isBlocked = query.blocked
  if (query.q) {
    if (/^\d{4,}$/.test(query.q)) {
      where.tgId = BigInt(query.q)
    } else {
      where.OR = [
        { username: { contains: query.q, mode: 'insensitive' } },
        { firstName: { contains: query.q, mode: 'insensitive' } }
      ]
    }
  }
  return where
}

export function registerAdminUserRoutes(app: FastifyInstance): void {
  app.get('/api/admin/users', async (req, reply) => {
    try {
      const query = listQuerySchema.parse(req.query)

      const users = await prisma.user.findMany({
        where: userListWhere(query),
        orderBy: { createdAt: 'desc' },
        take: query.limit,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        include: { _count: { select: { orders: true, referrals: true } } }
      })

      return {
        users: users.map((user) => ({
          id: user.id,
          tgId: user.tgId.toString(),
          username: user.username,
          firstName: user.firstName,
          languageCode: user.languageCode,
          isBlocked: user.isBlocked,
          isAdmin: isAdminId(user.tgId),
          ordersCount: user._count.orders,
          referralsCount: user._count.referrals,
          createdAt: user.createdAt.toISOString()
        })),
        nextCursor: users.length === query.limit ? (users[users.length - 1]?.id ?? null) : null
      }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })

  app.get('/api/admin/users/:id', async (req, reply) => {
    try {
      const { id } = idParamsSchema.parse(req.params)

      const user = await prisma.user.findUnique({
        where: { id },
        include: { _count: { select: { orders: true, referrals: true } } }
      })
      if (!user) throw notFound('api.errors.user_not_found')

      const [balanceCents, spent, toppedUp, orders, ledger] = await Promise.all([
        getBalance(prisma, user.id),
        prisma.balanceTransaction.aggregate({
          where: { userId: user.id, type: LedgerType.PURCHASE },
          _sum: { amountCents: true }
        }),
        prisma.balanceTransaction.aggregate({
          where: { userId: user.id, type: LedgerType.TOPUP },
          _sum: { amountCents: true }
        }),
        prisma.order.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: { plan: { select: { title: true, product: { select: { title: true } } } } }
        }),
        prisma.balanceTransaction.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: 'desc' },
          take: 10
        })
      ])

      return {
        user: {
          id: user.id,
          tgId: user.tgId.toString(),
          username: user.username,
          firstName: user.firstName,
          languageCode: user.languageCode,
          isBlocked: user.isBlocked,
          isAdmin: isAdminId(user.tgId),
          ordersCount: user._count.orders,
          referralsCount: user._count.referrals,
          createdAt: user.createdAt.toISOString()
        },
        balanceCents,
        totalSpentCents: spent._sum.amountCents ?? 0,
        totalToppedUpCents: toppedUp._sum.amountCents ?? 0,
        orders: orders.map((order) => ({
          id: order.id,
          status: order.status,
          provider: order.provider,
          amountCents: order.amountCents,
          productTitle: order.plan.product.title,
          planTitle: order.plan.title,
          createdAt: order.createdAt.toISOString()
        })),
        ledger: ledger.map((entry) => ({
          id: entry.id,
          type: entry.type,
          amountCents: entry.amountCents,
          orderId: entry.orderId,
          comment: entry.comment,
          createdAt: entry.createdAt.toISOString()
        }))
      }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })

  app.post('/api/admin/users/:id/balance', async (req, reply) => {
    try {
      const { id } = idParamsSchema.parse(req.params)
      const body = balanceBodySchema.parse(req.body)

      const user = await prisma.user.findUnique({ where: { id }, select: { id: true } })
      if (!user) throw notFound('api.errors.user_not_found')

      // credit()/debit() are idempotent per key (scope "ledger"), so a retried
      // request returns the already-booked entry. InsufficientBalance on debit
      // maps to 402 in describeError.
      const input = {
        userId: user.id,
        amountCents: Math.abs(body.amountCents),
        type: LedgerType.ADMIN_ADJUST,
        comment: body.comment,
        idempotencyKey: `admin-adjust:${body.idempotencyKey}`
      }
      const result = await prisma.$transaction((tx) =>
        body.amountCents > 0 ? credit(tx, input) : debit(tx, input)
      )

      await writeAdminAudit(req, 'user.balance_adjust', 'User', user.id, {
        amountCents: body.amountCents,
        comment: body.comment,
        idempotencyKey: body.idempotencyKey
      })

      return { userId: user.id, balanceCents: result.balanceAfterCents }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })

  app.post('/api/admin/users/:id/block', async (req, reply) => {
    try {
      const { id } = idParamsSchema.parse(req.params)
      const body = blockBodySchema.parse(req.body)

      const user = await prisma.user.findUnique({ where: { id }, select: { id: true, tgId: true, isBlocked: true } })
      if (!user) throw notFound('api.errors.user_not_found')

      // A blocked user is rejected at /api/auth/telegram, so blocking an admin
      // would lock them out of this very panel. Blocking yourself is the same
      // foot-gun one click earlier. Both answer 409, not 500.
      if (body.blocked && (user.id === req.auth?.userId || isAdminId(user.tgId))) {
        throw conflict()
      }

      if (user.isBlocked !== body.blocked) {
        await prisma.user.update({ where: { id: user.id }, data: { isBlocked: body.blocked } })
        await writeAdminAudit(req, body.blocked ? 'user.block' : 'user.unblock', 'User', user.id)
      }

      return { userId: user.id, isBlocked: body.blocked }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })
}
