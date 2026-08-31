import type { Redis } from 'ioredis'
import { z } from 'zod'
import type { Prisma, PrismaClient } from '@tgshop/db'
import type { PrismaTx } from './ledger.js'
import { SettingsValidationError } from './errors.js'

// ─────────────────────────────────────────────────────────────────────────────
// Shop settings: Postgres is the source of truth, Redis is a read-through cache.
//
// Every key has a zod schema AND a documented default, so a missing row can
// never take the shop down — and a hand-edited, malformed row fails loudly
// (SettingsValidationError) instead of silently changing prices or rates.
//
// setSetting invalidates rather than rewrites the cache: a DELETE cannot leave a
// stale value behind if the process dies between the DB write and the cache
// write, whereas a SET can.
// ─────────────────────────────────────────────────────────────────────────────

export const SETTING_SCHEMAS = {
  /** USD price of one Telegram Star, as a decimal STRING (never a float in a money path). */
  stars_usd_rate: z
    .coerce
    .string()
    .regex(/^\d+(\.\d{1,6})?$/, 'expected a decimal string like "0.013"')
    .refine((value) => /[1-9]/.test(value), 'rate must be greater than zero'),
  /** Minimum balance top-up, integer cents. */
  min_topup_cents: z.number().int().min(1),
  /** Support contact shown in the bot and Mini App. */
  support_url: z.string().url(),
  /** Referrer bonus, whole percent of the referee's first paid order. */
  referral_percent: z.number().int().min(0).max(100),
  /** Per-plan price overrides in integer cents: { [planId]: cents }. */
  price_override: z.record(z.string(), z.number().int().min(0)),
  /** How long a MANUAL_FALLBACK order may sit in DELIVERING before it is escalated. */
  manual_fallback_sla_minutes: z.number().int().min(1),
  /** Global broadcast send rate; Telegram tolerates ~30/s, we stay under it. */
  broadcast_rate_per_sec: z.number().int().min(1).max(30),
  /**
   * Largest order (integer cents) POST /internal/orders/:id/refund may refund
   * without a human. Above this it records a pending-approval audit entry
   * instead (docs/AGENT_PLAN.md). 0 sends every agent refund to a human.
   */
  refund_auto_approve_ceiling_cents: z.number().int().min(0),
  /** When enabled, an active product creation also queues its announcement. */
  new_product_auto_broadcast: z.boolean()
} as const

export type SettingKey = keyof typeof SETTING_SCHEMAS

export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTING_SCHEMAS)[K]>

/** Documented fallbacks, used when a key has no row yet. Mirrors packages/db/prisma/seed.ts. */
const SETTING_DEFAULTS: { [K in SettingKey]: SettingValue<K> } = {
  stars_usd_rate: '0.013',
  min_topup_cents: 500,
  support_url: 'https://t.me/tgshop_support',
  referral_percent: 5,
  price_override: {},
  manual_fallback_sla_minutes: 60,
  broadcast_rate_per_sec: 25,
  refund_auto_approve_ceiling_cents: 1000,
  new_product_auto_broadcast: false
}

const CACHE_PREFIX = 'tgshop:settings:'
const CACHE_TTL_SECONDS = 300

export const SETTING_KEYS = Object.keys(SETTING_SCHEMAS) as SettingKey[]

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTING_SCHEMAS, key)
}

function cacheKeyFor(key: SettingKey): string {
  return `${CACHE_PREFIX}${key}`
}

function parseSetting<K extends SettingKey>(key: K, raw: unknown): SettingValue<K> {
  const result = SETTING_SCHEMAS[key].safeParse(raw)
  if (!result.success) {
    throw new SettingsValidationError(key, result.error.issues.map((i) => i.message).join('; '))
  }
  return result.data as SettingValue<K>
}

/**
 * Reads a setting: Redis cache, then Postgres, then the documented default.
 * The value is zod-validated on every path, including out of the cache, so a
 * poisoned cache entry can never widen the type a caller receives.
 */
export async function getSetting<K extends SettingKey>(
  prisma: PrismaClient | PrismaTx,
  key: K,
  redis?: Redis
): Promise<SettingValue<K>> {
  if (redis) {
    const cached = await redis.get(cacheKeyFor(key))
    if (cached !== null) {
      try {
        return parseSetting(key, JSON.parse(cached))
      } catch (err) {
        // A bad cache entry (unparseable JSON or a value that no longer matches
        // the schema after a deploy) is recoverable: drop it and re-read from
        // Postgres, which is authoritative and throws for itself if it is bad.
        if (!(err instanceof SyntaxError) && !(err instanceof SettingsValidationError)) throw err
        await redis.del(cacheKeyFor(key))
      }
    }
  }

  const row = await prisma.setting.findUnique({ where: { key } })
  const value = row === null ? SETTING_DEFAULTS[key] : parseSetting(key, row.value)

  if (redis) {
    await redis.set(cacheKeyFor(key), JSON.stringify(value), 'EX', CACHE_TTL_SECONDS)
  }

  return value
}

/** Validates, persists, then invalidates the cached copy. Throws SettingsValidationError on bad input. */
export async function setSetting<K extends SettingKey>(
  prisma: PrismaClient,
  key: K,
  value: unknown,
  redis?: Redis
): Promise<void> {
  const parsed = parseSetting(key, value)
  const json = parsed as unknown as Prisma.InputJsonValue

  await prisma.setting.upsert({
    where: { key },
    update: { value: json },
    create: { key, value: json }
  })

  if (redis) {
    await redis.del(cacheKeyFor(key))
  }
}

/** Every known setting, defaults filled in for keys with no row. One query, no cache writes. */
export async function getSettings(
  prisma: PrismaClient,
  redis?: Redis
): Promise<Record<SettingKey, unknown>> {
  const rows = await prisma.setting.findMany({ where: { key: { in: SETTING_KEYS } } })
  const stored = new Map(rows.map((row) => [row.key, row.value]))

  const out = {} as Record<SettingKey, unknown>
  for (const key of SETTING_KEYS) {
    const raw = stored.get(key)
    out[key] = raw === undefined ? SETTING_DEFAULTS[key] : parseSetting(key, raw)
  }

  if (redis) {
    await Promise.all(
      SETTING_KEYS.map((key) =>
        redis.set(cacheKeyFor(key), JSON.stringify(out[key]), 'EX', CACHE_TTL_SECONDS)
      )
    )
  }

  return out
}

/** Drops every cached setting. Call after a bulk import that bypassed setSetting. */
export async function invalidateSettingsCache(redis: Redis): Promise<void> {
  await redis.del(...SETTING_KEYS.map(cacheKeyFor))
}
