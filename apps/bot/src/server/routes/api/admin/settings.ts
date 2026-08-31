import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@tgshop/db'
import { getSetting, isSettingKey, setSetting, SETTING_KEYS, type SettingKey } from '@tgshop/core'
import { redis } from '../../../../config/redis.js'
import { notFound, sendError } from '../../../../lib/httpErrors.js'
import { requestLocale } from '../context.js'
import { writeAdminAudit } from './shared.js'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/settings      — every registry key with its effective value
// PUT /api/admin/settings/:key — validate via core setSetting, audit old → new
//
// The value schemas live in ONE place: packages/core/src/settings.ts. This
// route never re-validates shapes itself — setSetting throws
// SettingsValidationError (→ 400) on bad input and invalidates the Redis cache
// on success, so the bot and worker pick the change up immediately.
// ─────────────────────────────────────────────────────────────────────────────

/** UI editor hint per key; the value contract itself stays in core. */
const SETTING_KINDS: Record<SettingKey, 'decimal' | 'cents' | 'int' | 'percent' | 'url' | 'json' | 'boolean'> = {
  stars_usd_rate: 'decimal',
  min_topup_cents: 'cents',
  support_url: 'url',
  referral_percent: 'percent',
  price_override: 'json',
  manual_fallback_sla_minutes: 'int',
  broadcast_rate_per_sec: 'int',
  refund_auto_approve_ceiling_cents: 'cents',
  new_product_auto_broadcast: 'boolean'
}

const keyParamsSchema = z.object({ key: z.string().min(1).max(100) })

const putBodySchema = z.object({
  value: z.unknown()
})

export function registerAdminSettingsRoutes(app: FastifyInstance): void {
  app.get('/api/admin/settings', async (req, reply) => {
    try {
      const settings = await Promise.all(
        SETTING_KEYS.map(async (key) => ({
          key,
          kind: SETTING_KINDS[key],
          value: await getSetting(prisma, key, redis)
        }))
      )
      return { settings }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })

  app.put('/api/admin/settings/:key', async (req, reply) => {
    try {
      const { key } = keyParamsSchema.parse(req.params)
      if (!isSettingKey(key)) throw notFound()

      const body = putBodySchema.parse(req.body)

      const previous = await getSetting(prisma, key, redis)
      await setSetting(prisma, key, body.value, redis)
      const next = await getSetting(prisma, key, redis)

      await writeAdminAudit(req, 'setting.update', 'Setting', key, JSON.parse(JSON.stringify({ previous, next })))

      return { key, value: next }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })
}
