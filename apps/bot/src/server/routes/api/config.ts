import type { FastifyInstance } from 'fastify'
import { prisma } from '@tgshop/db'
import { getSetting } from '@tgshop/core'
import { redis } from '../../../config/redis.js'
import { env } from '../../../config/env.js'
import { sendError } from '../../../lib/httpErrors.js'
import { requestLocale } from './context.js'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/config — static-ish client configuration for the Mini App's
// Settings screen: the bot's username and the operator-tunable support link
// (a Setting row, so it changes without a redeploy). Registered inside the
// authenticated scope like every other /api route.
// ─────────────────────────────────────────────────────────────────────────────

export function registerConfigRoutes(app: FastifyInstance): void {
  app.get('/api/config', async (req, reply) => {
    try {
      const supportUrl = await getSetting(prisma, 'support_url', redis)
      return {
        botUsername: env.BOT_USERNAME,
        supportUrl
      }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })
}
