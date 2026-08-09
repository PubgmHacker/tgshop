import type { AdminRole } from '@tgshop/db'

/**
 * Runtime-agnostic session token definitions and verification.
 *
 * This module is the single source of truth for the cookie name, TTL and token
 * format, and it is safe to import from **any** runtime (Edge middleware,
 * Node server components, server actions). It deliberately uses only Web Crypto
 * and has no `node:crypto` / `next/headers` / Prisma imports — the `AdminRole`
 * import is type-only and erased at compile time, so importing this file never
 * pulls Prisma into an Edge bundle.
 *
 * `session.ts` builds on this with the Node-only pieces (issuing cookies via
 * `next/headers`, synchronous `node:crypto` HMAC). Both sign the exact same
 * token format described below, so a cookie issued in a server action verifies
 * in Edge middleware and vice versa.
 *
 * Token format: `base64url(utf8 json payload) "." base64url(hmac-sha256 of the
 * first segment, keyed with SESSION_SECRET)`.
 */

export const SESSION_COOKIE_NAME = 'tgshop_admin_session'
export const SESSION_TTL_SECONDS = 60 * 60 * 12 // 12h

export interface SessionPayload {
  adminId: string
  role: AdminRole
  email: string
  issuedAt: number
  expiresAt: number
}

/** Decodes a base64url string to raw bytes. Throws on malformed input. */
function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/** Splits a token into its payload and signature segments, or null if malformed. */
function splitToken(cookieValue: string): { json: string; signature: string } | null {
  const parts = cookieValue.split('.')
  if (parts.length !== 2) return null
  const [json, signature] = parts
  if (!json || !signature) return null
  return { json, signature }
}

/** Parses the payload segment and enforces expiry. Returns null on any failure. */
function parsePayload(json: string): SessionPayload | null {
  const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(json))) as SessionPayload
  if (typeof payload.expiresAt !== 'number' || payload.expiresAt < Date.now()) {
    return null
  }
  return payload
}

/**
 * Verifies signature + expiry and decodes the cookie value using Web Crypto.
 * Works in the Edge runtime (and Node 20+). Returns null on any failure —
 * bad signature, malformed token, or expired session.
 *
 * `crypto.subtle.verify` performs the comparison in constant time, so this is
 * equivalent to the `timingSafeEqual` check in the Node implementation.
 */
export async function verifySessionToken(
  cookieValue: string | undefined,
  secret: string | undefined
): Promise<SessionPayload | null> {
  if (!cookieValue || !secret) return null

  const parts = splitToken(cookieValue)
  if (!parts) return null

  try {
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    )
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      base64UrlToBytes(parts.signature),
      encoder.encode(parts.json)
    )
    if (!valid) return null

    return parsePayload(parts.json)
  } catch {
    return null
  }
}
