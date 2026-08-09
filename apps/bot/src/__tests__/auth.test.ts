import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { InitDataError, validateTelegramInitData } from '../server/auth.js'

// Must match apps/bot/src/__tests__/setup-env.ts — the HMAC key is derived from
// the bot token, so a mismatch here would make every valid case fail.
const BOT_TOKEN = '000000:UNIT-TEST-PLACEHOLDER-TOKEN'

const USER = { id: 777_000_111, username: 'tester', first_name: 'Test', language_code: 'ru' }

/**
 * Builds a real signed initData string the way Telegram does: sort the pairs by
 * key, join as `k=v` with newlines, then HMAC-SHA256 with a key that is itself
 * HMAC('WebAppData', botToken). Signing here rather than pasting a fixture
 * keeps the test honest — it exercises the same derivation the server does.
 */
function signInitData(
  fields: Record<string, string>,
  botToken: string = BOT_TOKEN
): string {
  const dataCheckString = Object.entries(fields)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest()
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex')
  const params = new URLSearchParams({ ...fields, hash })
  return params.toString()
}

const nowSeconds = (): number => Math.floor(Date.now() / 1000)

function validFields(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    auth_date: String(nowSeconds()),
    query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
    user: JSON.stringify(USER),
    ...overrides
  }
}

describe('validateTelegramInitData', () => {
  it('accepts a correctly signed payload and derives the user from it', () => {
    const result = validateTelegramInitData(signInitData(validFields()), BOT_TOKEN)
    expect(result.tgId).toBe(BigInt(USER.id))
    expect(result.username).toBe('tester')
    expect(result.firstName).toBe('Test')
    expect(result.languageCode).toBe('ru')
  })

  it('returns tgId as a bigint, so ids past 2^53 survive the round trip', () => {
    // Telegram ids are 64-bit; a Number here would silently lose precision and
    // collapse two distinct users onto one account.
    const bigId = 9_007_199_254_740_993n // 2^53 + 1, not representable as a double
    const fields = validFields({ user: JSON.stringify({ ...USER, id: Number(bigId) }) })
    const result = validateTelegramInitData(signInitData(fields), BOT_TOKEN)
    expect(typeof result.tgId).toBe('bigint')
  })

  it('rejects a tampered field even though the hash is untouched', () => {
    // The core guarantee: flip the user id to impersonate someone and the
    // recomputed HMAC no longer matches.
    const signed = signInitData(validFields())
    const params = new URLSearchParams(signed)
    params.set('user', JSON.stringify({ ...USER, id: 1 }))
    expect(() => validateTelegramInitData(params.toString(), BOT_TOKEN)).toThrow(InitDataError)
  })

  it('rejects a payload signed with a different bot token', () => {
    const signed = signInitData(validFields(), '111111:SOME-OTHER-BOT-TOKEN')
    expect(() => validateTelegramInitData(signed, BOT_TOKEN)).toThrow(/hash mismatch/)
  })

  it('rejects a missing hash', () => {
    const params = new URLSearchParams(validFields())
    expect(() => validateTelegramInitData(params.toString(), BOT_TOKEN)).toThrow(/missing hash/)
  })

  // Regression guard for the constant-time comparison. timingSafeEqual throws a
  // RangeError on unequal buffer lengths, so a truncated or over-long hash has
  // to be caught by the explicit length check first and surface as a normal
  // InitDataError — not as an unhandled 500.
  it.each([
    ['truncated', (h: string) => h.slice(0, 32)],
    ['over-long', (h: string) => h + 'ff'],
    ['empty-ish non-hex', () => 'not-a-hash'],
    ['right length, wrong value', (h: string) => 'f'.repeat(h.length)]
  ])('rejects a %s hash with InitDataError, not a RangeError', (_label, mangle) => {
    const params = new URLSearchParams(signInitData(validFields()))
    const original = params.get('hash')
    expect(original).toBeTruthy()
    params.set('hash', mangle(original as string))
    expect(() => validateTelegramInitData(params.toString(), BOT_TOKEN)).toThrow(InitDataError)
  })

  it('rejects a stale auth_date past the 24h window', () => {
    const fields = validFields({ auth_date: String(nowSeconds() - 24 * 60 * 60 - 60) })
    expect(() => validateTelegramInitData(signInitData(fields), BOT_TOKEN)).toThrow(/stale/)
  })

  it('accepts an auth_date just inside the 24h window', () => {
    const fields = validFields({ auth_date: String(nowSeconds() - 24 * 60 * 60 + 60) })
    expect(() => validateTelegramInitData(signInitData(fields), BOT_TOKEN)).not.toThrow()
  })

  it('rejects an auth_date far in the future', () => {
    // Guards against a replay built with a forward-dated timestamp to sidestep
    // the staleness check; a small skew (<=60s) is tolerated on purpose.
    const fields = validFields({ auth_date: String(nowSeconds() + 600) })
    expect(() => validateTelegramInitData(signInitData(fields), BOT_TOKEN)).toThrow(/future/)
  })

  it('rejects a missing auth_date', () => {
    const fields = { query_id: 'x', user: JSON.stringify(USER) }
    expect(() => validateTelegramInitData(signInitData(fields), BOT_TOKEN)).toThrow(
      /missing auth_date/
    )
  })

  it('rejects a signed payload with no user field', () => {
    const fields = { auth_date: String(nowSeconds()), query_id: 'x' }
    expect(() => validateTelegramInitData(signInitData(fields), BOT_TOKEN)).toThrow(/missing user/)
  })

  it('rejects malformed user JSON even when correctly signed', () => {
    const fields = validFields({ user: '{not json' })
    expect(() => validateTelegramInitData(signInitData(fields), BOT_TOKEN)).toThrow(
      /malformed user JSON/
    )
  })

  it('rejects a user object without a numeric id', () => {
    const fields = validFields({ user: JSON.stringify({ username: 'no-id' }) })
    expect(() => validateTelegramInitData(signInitData(fields), BOT_TOKEN)).toThrow()
  })

  it('leaves optional user fields null rather than undefined', () => {
    const fields = validFields({ user: JSON.stringify({ id: USER.id }) })
    const result = validateTelegramInitData(signInitData(fields), BOT_TOKEN)
    expect(result.username).toBeNull()
    expect(result.firstName).toBeNull()
    expect(result.languageCode).toBeNull()
  })
})
