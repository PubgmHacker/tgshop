import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchJsonWithTimeout, withRequestTimeout } from '@tgshop/ui/request'

beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('bounded Mini App requests', () => {
  it('cancels a body that stalls after successful headers, without AbortSignal.timeout', async () => {
    let requestSignal: AbortSignal | undefined
    vi.stubGlobal('AbortSignal', undefined)
    vi.stubGlobal('fetch', (_url: string, init: { signal: AbortSignal }) => {
      requestSignal = init.signal
      return Promise.resolve({ status: 200, json: () => new Promise(() => {}) })
    })
    const failed = expect(fetchJsonWithTimeout('/api/me', {}, 100)).rejects.toMatchObject({ name: 'TimeoutError' })
    await vi.advanceTimersByTimeAsync(100)
    await failed
    expect(requestSignal?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not wait forever for a request implementation that ignores cancellation', async () => {
    const failed = expect(withRequestTimeout(() => new Promise(() => {}), 100)).rejects.toMatchObject({ name: 'TimeoutError' })
    await vi.advanceTimersByTimeAsync(100)
    await failed
  })

  it('returns JSON and clears the deadline on success', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('{"balanceCents":0}')))
    const result = await fetchJsonWithTimeout('/api/me')
    expect(result.response.status).toBe(200)
    expect(result.body).toEqual({ balanceCents: 0 })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the HTTP status of a non-JSON gateway error', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('Bad gateway', { status: 502 })))
    const result = await fetchJsonWithTimeout('/api/me')
    expect(result.response.status).toBe(502)
    expect(result.body).toBeUndefined()
  })

  it('preserves transport failures so purchase retries retain their idempotency key', async () => {
    const networkError = new TypeError('Connection lost')
    vi.stubGlobal('fetch', () => Promise.reject(networkError))
    await expect(fetchJsonWithTimeout('/api/orders', { method: 'POST' })).rejects.toBe(networkError)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves connection loss during body reading as a network failure', async () => {
    const networkError = new TypeError('Stream disconnected')
    vi.stubGlobal('fetch', () => Promise.resolve({ json: () => Promise.reject(networkError) }))
    await expect(fetchJsonWithTimeout('/api/orders', { method: 'POST' })).rejects.toBe(networkError)
    expect(vi.getTimerCount()).toBe(0)
  })
})
