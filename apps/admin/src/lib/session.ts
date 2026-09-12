import { createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { getEnv } from './env'
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  type SessionPayload
} from './session-token'
import type { AdminRole } from '@tgshop/db'

/**
 * Node-runtime session helpers (server components, server actions, route handlers).
 *
 * The cookie name, TTL, payload shape and token format all live in
 * `session-token.ts` so that the Edge middleware verifier cannot drift from
 * this implementation. Edge code must import from `session-token.ts` directly —
 * this module pulls in `node:crypto` and `next/headers`, neither of which is
 * available in the Edge runtime.
 */

export { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS, type SessionPayload }

function sign(value: string): string {
  const secret = getEnv().SESSION_SECRET
  return createHmac('sha256', secret).update(value).digest('base64url')
}

/** Serializes and signs a session payload into an opaque cookie value: base64url(json).signature */
export function encodeSession(payload: SessionPayload): string {
  const json = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const signature = sign(json)
  return `${json}.${signature}`
}

/** Verifies signature + expiry and decodes the cookie value. Returns null on any failure. */
export function decodeSession(cookieValue: string | undefined): SessionPayload | null {
  if (!cookieValue) return null
  const parts = cookieValue.split('.')
  if (parts.length !== 2) return null
  const [json, signature] = parts
  if (!json || !signature) return null

  const expected = sign(json)
  const sigBuf = Buffer.from(signature, 'utf8')
  const expBuf = Buffer.from(expected, 'utf8')
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null
  }

  try {
    const payload = JSON.parse(Buffer.from(json, 'base64url').toString('utf8')) as SessionPayload
    if (typeof payload.expiresAt !== 'number' || payload.expiresAt < Date.now()) {
      return null
    }
    return payload
  } catch {
    return null
  }
}

/** Reads and validates the current request's session cookie (server components / route handlers / server actions). */
export async function getSession(): Promise<SessionPayload | null> {
  const raw = (await cookies()).get(SESSION_COOKIE_NAME)?.value
  return decodeSession(raw)
}

/** Builds a fresh signed session cookie value for a just-authenticated admin. */
export function createSessionValue(admin: { id: string; role: AdminRole; email: string }): string {
  const now = Date.now()
  return encodeSession({
    adminId: admin.id,
    role: admin.role,
    email: admin.email,
    issuedAt: now,
    expiresAt: now + SESSION_TTL_SECONDS * 1000
  })
}

export const SESSION_MAX_AGE_SECONDS = SESSION_TTL_SECONDS
