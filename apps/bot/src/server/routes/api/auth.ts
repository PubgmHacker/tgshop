import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getBalance } from '@tgshop/core'
import { prisma } from '@tgshop/db'
import { InitDataError, issueMiniAppJwt, validateTelegramInitData, JWT_TTL_SECONDS } from '../../auth.js'
import { findOrCreateUser } from '../../../domain/users.js'
import { env } from '../../../config/env.js'
import { resolveLocale } from '../../../i18n/index.js'
import { HttpError, notFound, sendError } from '../../../lib/httpErrors.js'
import { logger } from '../../../lib/logger.js'

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/telegram — the only unauthenticated /api route.
//
// Validates Telegram WebApp initData server-side (HMAC over the sorted
// data-check-string, keyed by HMAC_SHA256("WebAppData", BOT_TOKEN)), upserts
// the User, honours a `start_param` referral, and issues the short-lived JWT
// every other /api route requires. The client never supplies a userId.
// ─────────────────────────────────────────────────────────────────────────────

const authBodySchema = z.object({
  initData: z.string().min(1).max(4096)
})

/**
 * Resolves a `ref_*` start_param into the referrer's Telegram id.
 *
 * The bot's /start deep link uses `ref_<tgId>` (see bot/handlers/start.ts), so
 * a numeric payload is treated as a Telegram id. A non-numeric payload is
 * treated as an internal User.id and resolved to its tgId, which keeps links
 * built by buildReferralLink() (`ref_<User.id>`) working too.
 */
async function resolveReferrerTgId(startParam: string | null): Promise<bigint | null> {
  if (!startParam?.startsWith('ref_')) return null
  const raw = startParam.slice('ref_'.length)
  if (raw.length === 0) return null

  if (/^\d+$/.test(raw)) {
    try {
      return BigInt(raw)
    } catch {
      return null
    }
  }

  const referrer = await prisma.user.findUnique({ where: { id: raw }, select: { tgId: true } })
  return referrer?.tgId ?? null
}

export function registerAuthRoutes(app: FastifyInstance): void {
  // Development-only: browser preview without Telegram WebApp initData.
  // Disabled in production even if DEV_PREVIEW_TG_ID is present.
  app.post('/api/auth/dev', async (req, reply) => {
    const locale = resolveLocale(req.headers['accept-language'])
    if (env.NODE_ENV !== 'development' || env.DEV_PREVIEW_TG_ID === undefined) {
      await sendError(reply, notFound(), locale)
      return
    }

    try {
      const user = await findOrCreateUser({
        tgId: env.DEV_PREVIEW_TG_ID,
        username: 'preview',
        firstName: 'Preview',
        languageCode: 'ru',
        referredByTgId: null
      })

      if (user.isBlocked) {
        throw new HttpError(403, 'USER_BLOCKED', 'api.errors.blocked')
      }

      const accessToken = issueMiniAppJwt({ sub: user.id, tgId: user.tgId.toString() })
      const balanceCents = await getBalance(prisma, user.id)

      return {
        accessToken,
        expiresAt: new Date(Date.now() + JWT_TTL_SECONDS * 1000).toISOString(),
        user: {
          id: user.id,
          languageCode: user.languageCode,
          balanceCents
        }
      }
    } catch (err) {
      await sendError(reply, err, locale)
      return
    }
  })

  app.post('/api/auth/telegram', async (req, reply) => {
    const locale = resolveLocale(req.headers['accept-language'])

    try {
      const body = authBodySchema.parse(req.body)
      const validated = validateTelegramInitData(body.initData, env.BOT_TOKEN)

      const params = new URLSearchParams(body.initData)
      const referrerTgId = await resolveReferrerTgId(params.get('start_param'))

      const user = await findOrCreateUser({
        tgId: validated.tgId,
        username: validated.username,
        firstName: validated.firstName,
        languageCode: validated.languageCode,
        // Never let a user refer themselves into their own bonus.
        referredByTgId: referrerTgId !== null && referrerTgId !== validated.tgId ? referrerTgId : null
      })

      if (user.isBlocked) {
        throw new HttpError(403, 'USER_BLOCKED', 'api.errors.blocked')
      }

      const accessToken = issueMiniAppJwt({ sub: user.id, tgId: user.tgId.toString() })
      const balanceCents = await getBalance(prisma, user.id)

      return {
        accessToken,
        expiresAt: new Date(Date.now() + JWT_TTL_SECONDS * 1000).toISOString(),
        user: {
          id: user.id,
          languageCode: user.languageCode,
          balanceCents
        }
      }
    } catch (err) {
      if (err instanceof InitDataError) {
        // Do not echo the reason to the client: a precise "hash mismatch" vs
        // "stale auth_date" distinction is an oracle for forging attempts.
        logger.warn({ reason: err.message }, 'rejected Telegram initData')
        await sendError(reply, new HttpError(401, 'INVALID_INIT_DATA', 'api.errors.invalid_init_data'), locale)
        return
      }
      await sendError(reply, err, locale)
      return
    }
  })
}
