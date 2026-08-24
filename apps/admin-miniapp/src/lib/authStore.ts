'use client'

/**
 * In-memory-only JWT store. Deliberately NOT persisted to localStorage/sessionStorage
 * per the security requirement: the token must not survive a full page reload outside
 * of this module's module-scope variable, and is re-acquired via /api/auth/telegram on
 * every fresh mount.
 */

interface AuthState {
  accessToken: string | null
  expiresAt: number | null // epoch ms
}

let state: AuthState = { accessToken: null, expiresAt: null }
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

export function setAuthSession(accessToken: string, expiresAtIso: string): void {
  state = { accessToken, expiresAt: new Date(expiresAtIso).getTime() }
  notify()
}

export function clearAuthSession(): void {
  state = { accessToken: null, expiresAt: null }
  notify()
}

export function getAccessToken(): string | null {
  if (!state.accessToken || !state.expiresAt) return null
  // Treat as expired 30s before actual expiry to avoid racing the server clock.
  if (Date.now() >= state.expiresAt - 30_000) return null
  return state.accessToken
}

export function isAuthExpiringSoon(): boolean {
  if (!state.expiresAt) return true
  return Date.now() >= state.expiresAt - 60_000
}

export function subscribeAuth(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
