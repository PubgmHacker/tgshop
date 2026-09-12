'use client'

import { ZodError } from 'zod'
import type { DictionaryKey } from '@/i18n/dictionaries'
import { ApiClientError } from './apiClient'

// ─────────────────────────────────────────────────────────────────────────────
// One place that decides what a failure means to the user. The server answered
// (ApiClientError) or answered with a shape we do not understand (ZodError) —
// that is not a connectivity problem, so the screen must not claim "no
// connection". Only fetch failures and timeouts are network errors.
// ─────────────────────────────────────────────────────────────────────────────

export function isNetworkError(err: unknown): boolean {
  if (err instanceof ApiClientError || err instanceof ZodError) return false
  if (err instanceof DOMException) return err.name === 'AbortError' || err.name === 'TimeoutError'
  return err instanceof TypeError || (err instanceof Error && err.name === 'AbortError')
}

/** Whether the request may have reached the server (so a retry must reuse its idempotency key). */
export function mayHaveReachedServer(err: unknown): boolean {
  return isNetworkError(err)
}

const CODE_KEYS: Record<string, DictionaryKey> = {
  INSUFFICIENT_BALANCE: 'checkout.insufficientBalance',
  PAYMENT_METHOD_UNAVAILABLE: 'checkout.methodUnavailable',
  STOCK_UNAVAILABLE: 'checkout.stockUnavailable',
  PROMO_INVALID: 'buySheet.promoInvalid',
  USER_BLOCKED: 'common.error.blocked',
  NO_INIT_DATA: 'common.error.auth',
  AUTH_FAILED: 'common.error.auth',
  UNAUTHORIZED: 'common.error.auth',
  INVALID_INIT_DATA: 'common.error.auth'
}

/** Translation key for a failed query/mutation: a specific server code, a network failure, or the generic fallback. */
export function errorMessageKey(err: unknown): DictionaryKey {
  if (err instanceof ApiClientError) return CODE_KEYS[err.code] ?? 'common.error.generic'
  if (isNetworkError(err)) return 'common.error.network'
  return 'common.error.generic'
}
