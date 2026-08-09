import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { getEnv } from './env'

export interface TelegramLoginPayload {
  id: number
  first_name: string
  last_name?: string
  username?: string
  photo_url?: string
  auth_date: number
  hash: string
}

const MAX_AUTH_AGE_SECONDS = 86400

/**
 * Verifies the Telegram Login Widget payload per
 * https://core.telegram.org/widgets/login#checking-authorization.
 * secret_key = SHA256(bot_token); data_check_string is all fields except
 * `hash`, sorted alphabetically as "key=value" joined by "\n"; expected
 * hash = HMAC_SHA256(data_check_string, secret_key) hex-encoded.
 */
export function verifyTelegramLogin(payload: TelegramLoginPayload): boolean {
  const botToken = getEnv().BOT_TOKEN
  if (!botToken) return false

  const { hash, ...rest } = payload
  if (!hash) return false

  const now = Math.floor(Date.now() / 1000)
  if (now - payload.auth_date > MAX_AUTH_AGE_SECONDS) {
    return false
  }

  const dataCheckString = Object.entries(rest)
    .filter(([, value]) => value !== undefined && value !== null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join('\n')

  const secretKey = createHash('sha256').update(botToken).digest()
  const expectedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex')

  const hashBuf = Buffer.from(hash, 'utf8')
  const expectedBuf = Buffer.from(expectedHash, 'utf8')
  if (hashBuf.length !== expectedBuf.length) return false
  return timingSafeEqual(hashBuf, expectedBuf)
}
