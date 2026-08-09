import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@tgshop/db'
import {
  getReferralStats,
  getUserBalance,
  getUserTotalSpentCents,
  buildReferralLink
} from '../../../domain/users.js'
import { listUserOrders, listUserSubscriptions } from '../../../domain/orders.js'
import { env } from '../../../config/env.js'
import { notFound, sendError } from '../../../lib/httpErrors.js'
import { requestLocale, requireUserId } from './context.js'
import { toOrderListItemDto, toSubscriptionItemDto } from './presenters.js'

// ─────────────────────────────────────────────────────────────────────────────
// Profile / balance / history. Every handler derives the user from the JWT.
// ─────────────────────────────────────────────────────────────────────────────

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20)
})

export function registerMeRoutes(app: FastifyInstance): void {
  // GET /api/profile — the Mini App's profile screen (user + orders + subs).
  app.get('/api/profile', async (req, reply) => {
    try {
      const userId = requireUserId(req)
      const user = await prisma.user.findUnique({ where: { id: userId } })
      if (!user) throw notFound('api.errors.user_not_found')

      const [balanceCents, referral, orders, subscriptions] = await Promise.all([
        getUserBalance(userId),
        getReferralStats(userId),
        listUserOrders(userId, 20),
        listUserSubscriptions(userId)
      ])

      return {
        user: {
          id: user.id,
          balanceCents,
          languageCode: user.languageCode,
          // The Mini App appends this to `?start=`, so it must be the full
          // deep-link payload the bot's /start parser understands.
          referralCode: `ref_${user.tgId.toString()}`,
          referralCount: referral.count
        },
        orders: orders.map(toOrderListItemDto),
        subscriptions: subscriptions.map(toSubscriptionItemDto)
      }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })

  // GET /api/me — profile plus referral link and lifetime totals.
  app.get('/api/me', async (req, reply) => {
    try {
      const userId = requireUserId(req)
      const user = await prisma.user.findUnique({ where: { id: userId } })
      if (!user) throw notFound('api.errors.user_not_found')

      const [balanceCents, referral, totalSpentCents] = await Promise.all([
        getUserBalance(userId),
        getReferralStats(userId),
        getUserTotalSpentCents(userId)
      ])

      return {
        user: {
          id: user.id,
          tgId: user.tgId.toString(),
          username: user.username,
          firstName: user.firstName,
          languageCode: user.languageCode,
          isBlocked: user.isBlocked,
          createdAt: user.createdAt.toISOString()
        },
        balanceCents,
        totalSpentCents,
        referral: {
          code: `ref_${user.tgId.toString()}`,
          link: buildReferralLink(env.BOT_USERNAME, user.tgId),
          count: referral.count,
          earningsCents: referral.earningsCents
        }
      }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })

  // GET /api/balance — cheap poll target for the balance pill.
  app.get('/api/balance', async (req, reply) => {
    try {
      const userId = requireUserId(req)
      return { balanceCents: await getUserBalance(userId) }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })

  // GET /api/me/orders — order history.
  app.get('/api/me/orders', async (req, reply) => {
    try {
      const userId = requireUserId(req)
      const { limit } = listQuerySchema.parse(req.query)
      const orders = await listUserOrders(userId, limit)
      return { orders: orders.map(toOrderListItemDto) }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })

  // GET /api/me/subscriptions — active and past subscriptions.
  app.get('/api/me/subscriptions', async (req, reply) => {
    try {
      const userId = requireUserId(req)
      const subscriptions = await listUserSubscriptions(userId)
      return { subscriptions: subscriptions.map(toSubscriptionItemDto) }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })
}
