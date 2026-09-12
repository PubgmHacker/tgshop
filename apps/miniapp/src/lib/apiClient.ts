'use client'

import type { z } from 'zod'
import { fetchJsonWithTimeout } from '@tgshop/ui/request'
import { AuthResponseSchema } from '@/types/api'
import { clearAuthSession, getAccessToken, setAuthSession } from './authStore'
import { readInitDataFromLocation } from './launchParams'

// Production is same-origin: next.config.js rewrites relay /api/* to the bot
// server-side, so the WebView never has to reach a second host.
const API_URL = process.env.NODE_ENV === 'production' ? '' : (process.env.NEXT_PUBLIC_API_URL ?? '')

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
  const result = initData
    ? await fetchJsonWithTimeout(`${API_URL}/api/auth/telegram`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ initData })
      })
    : process.env.NODE_ENV === 'development' && API_URL
      ? await fetchJsonWithTimeout(`${API_URL}/api/auth/dev`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}'
        })
      : null

  if (!result) {
    throw new ApiClientError(401, 'NO_INIT_DATA', 'Telegram initData is not available')
  }
  const { response: res, body } = result
  if (!res.ok) {
    throw new ApiClientError(res.status, 'AUTH_FAILED', 'Authentication failed')
  }
  const parsed = AuthResponseSchema.parse(body)
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

  const { response: res, body } = await fetchJsonWithTimeout(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  })

  if (res.status === 401 && !options.skipAuth) {
    clearAuthSession()
    await ensureAuth()
    return request(path, schema, { ...options, skipAuth: true })
  }

  if (!res.ok) {
    let code = 'UNKNOWN'
    let message = `Request failed with status ${res.status}`
    const details = (body as { error?: { code?: unknown; message?: unknown } } | null | undefined)?.error
    if (typeof details?.code === 'string') code = details.code
    if (typeof details?.message === 'string') message = details.message
    throw new ApiClientError(res.status, code, message)
  }

  return schema.parse(body)
}

export const api = {
  get: <T>(path: string, schema: z.ZodType<T>) => request(path, schema, { method: 'GET' }),
  post: <T>(path: string, schema: z.ZodType<T>, body?: unknown) => request(path, schema, { method: 'POST', body }),
  patch: <T>(path: string, schema: z.ZodType<T>, body?: unknown) => request(path, schema, { method: 'PATCH', body })
}
