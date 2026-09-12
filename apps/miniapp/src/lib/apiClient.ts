'use client'

import type { z } from 'zod'
import { AuthResponseSchema } from '@/types/api'
import { clearAuthSession, getAccessToken, setAuthSession } from './authStore'
import { readInitDataFromLocation } from './launchParams'

// Production is same-origin: next.config.js rewrites relay /api/* to the bot
// server-side, so the WebView never has to reach a second host.
const API_URL = process.env.NODE_ENV === 'production' ? '' : (process.env.NEXT_PUBLIC_API_URL ?? '')

const REQUEST_TIMEOUT_MS = 15_000

function requestTimeoutSignal(ms: number): AbortSignal | undefined {
  if (typeof AbortSignal === 'undefined' || typeof AbortSignal.timeout !== 'function') return undefined
  return AbortSignal.timeout(ms)
}

export class ApiClientError extends Error {
  public readonly status: number
  public readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiClientError'
    this.status = status
    this.code = code
  }
}

let refreshPromise: Promise<void> | null = null
let initDataRef: string | null = null

/** Called once at boot with the raw Telegram WebApp initData string. */
export function setInitData(initData: string): void {
  initDataRef = initData
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem('tgshop.initData', initData)
  } catch {
    // private mode / quota — ignore
  }
}

function resolveInitData(): string | null {
  if (initDataRef) return initDataRef
  const fromLocation = readInitDataFromLocation()
  if (fromLocation) {
    initDataRef = fromLocation
  }
  return initDataRef
}

async function authenticate(): Promise<void> {
  const initData = resolveInitData()
  const res = initData
    ? await fetch(`${API_URL}/api/auth/telegram`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ initData }),
        signal: requestTimeoutSignal(REQUEST_TIMEOUT_MS)
      })
    : process.env.NODE_ENV === 'development' && API_URL
      ? await fetch(`${API_URL}/api/auth/dev`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
          signal: requestTimeoutSignal(REQUEST_TIMEOUT_MS)
        })
      : null

  if (!res) {
    throw new ApiClientError(401, 'NO_INIT_DATA', 'Telegram initData is not available')
  }
  if (!res.ok) {
    throw new ApiClientError(res.status, 'AUTH_FAILED', 'Authentication failed')
  }
  const json = await res.json()
  const parsed = AuthResponseSchema.parse(json)
  setAuthSession(parsed.accessToken, parsed.expiresAt)
}

async function ensureAuth(): Promise<void> {
  if (getAccessToken()) return
  if (!refreshPromise) {
    refreshPromise = authenticate().finally(() => {
      refreshPromise = null
    })
  }
  await refreshPromise
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  skipAuth?: boolean
}

async function request<T>(path: string, schema: z.ZodType<T>, options: RequestOptions = {}): Promise<T> {
  if (!options.skipAuth) {
    await ensureAuth()
  }

  const token = getAccessToken()
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`

  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    // A stalled mobile connection otherwise leaves the screen loading forever;
    // callers treat the resulting TimeoutError as a network failure.
    signal: requestTimeoutSignal(REQUEST_TIMEOUT_MS)
  })

  if (res.status === 401 && !options.skipAuth) {
    clearAuthSession()
    await ensureAuth()
    return request(path, schema, { ...options, skipAuth: true }).then(async (result) => result)
  }

  if (!res.ok) {
    let code = 'UNKNOWN'
    let message = `Request failed with status ${res.status}`
    try {
      const errJson = await res.json()
      code = errJson?.error?.code ?? code
      message = errJson?.error?.message ?? message
    } catch {
      // response body was not JSON; keep defaults
    }
    throw new ApiClientError(res.status, code, message)
  }

  const json = await res.json()
  return schema.parse(json)
}

export const api = {
  get: <T>(path: string, schema: z.ZodType<T>) => request(path, schema, { method: 'GET' }),
  post: <T>(path: string, schema: z.ZodType<T>, body?: unknown) => request(path, schema, { method: 'POST', body }),
  patch: <T>(path: string, schema: z.ZodType<T>, body?: unknown) => request(path, schema, { method: 'PATCH', body })
}
