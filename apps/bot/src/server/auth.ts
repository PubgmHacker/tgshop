import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'

// ─────────────────────────────────────────────────────────────────────────────
// Telegram WebApp initData validation, per
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
// ─────────────────────────────────────────────────────────────────────────────

const INIT_DATA_MAX_AGE_SECONDS = 24 * 60 * 60

const telegramUserSchema = z.object({
  id: z.number().int(),
  username: z.string().optional(),
  first_name: z.string().optional(),
  language_code: z.string().optional()
})

export interface ValidatedInitData {
  tgId: bigint
  username: string | null
  firstName: string | null
  languageCode: string | null
  authDate: number
}

export class InitDataError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InitDataError'
  }
}

/**
 * Validates Telegram Mini App `initData` server-side using HMAC-SHA256 with a
 * key derived from the bot token, and enforces auth_date freshness (<=24h).
 */
export function validateTelegramInitData(initData: string, botToken: string): ValidatedInitData {
  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) {
    throw new InitDataError('missing hash')
  }
  params.delete('hash')

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest()
  const computedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex')

  // Constant-time, like every other HMAC check in the repo (see
  // apps/bot/src/payments/cryptobot.ts and apps/admin/src/lib/telegram-auth.ts).
  // `hash` is attacker-controlled, so a short-circuiting `!==` leaks how many
  // leading hex digits were right, which is enough to forge a hash byte by byte
  // and mint a JWT for any tgId. Length is compared first because
  // timingSafeEqual throws on a length mismatch.
  const providedHashBuf = Buffer.from(hash, 'utf8')
  const computedHashBuf = Buffer.from(computedHash, 'utf8')
  if (
    providedHashBuf.length !== computedHashBuf.length ||
    !timingSafeEqual(providedHashBuf, computedHashBuf)
  ) {
    throw new InitDataError('hash mismatch')
  }

  const authDateStr = params.get('auth_date')
  if (!authDateStr) {
    throw new InitDataError('missing auth_date')
  }
  const authDate = Number.parseInt(authDateStr, 10)
  if (!Number.isFinite(authDate)) {
    throw new InitDataError('invalid auth_date')
  }
  const ageSeconds = Math.floor(Date.now() / 1000) - authDate
  if (ageSeconds > INIT_DATA_MAX_AGE_SECONDS || ageSeconds < -60) {
    throw new InitDataError('auth_date is stale or in the future')
  }

  const userRaw = params.get('user')
  if (!userRaw) {
    throw new InitDataError('missing user')
  }
  let userJson: unknown
  try {
    userJson = JSON.parse(userRaw)
  } catch {
    throw new InitDataError('malformed user JSON')
  }
  const user = telegramUserSchema.parse(userJson)

  return {
    tgId: BigInt(user.id),
    username: user.username ?? null,
    firstName: user.first_name ?? null,
    languageCode: user.language_code ?? null,
    authDate
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Short-lived JWT issued after initData validation, required on every other
// /api route. Never trust a client-supplied userId — always derive from this.
// ─────────────────────────────────────────────────────────────────────────────

export interface MiniAppJwtPayload {
  sub: string // internal User.id
  tgId: string // BigInt as string
}

const JWT_TTL_SECONDS = 60 * 60 // 1h

export { JWT_TTL_SECONDS }

export function issueMiniAppJwt(payload: MiniAppJwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: JWT_TTL_SECONDS, algorithm: 'HS256' })
}

export function verifyMiniAppJwt(token: string): MiniAppJwtPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] })
  if (typeof decoded === 'string') {
    throw new InitDataError('malformed token')
  }
  const parsed = z.object({ sub: z.string(), tgId: z.string() }).safeParse(decoded)
  if (!parsed.success) {
    throw new InitDataError('malformed token payload')
  }
  return parsed.data
}
