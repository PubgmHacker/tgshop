import { describe, it, expect, vi } from 'vitest'
import { getUsdPrice } from '../src/oracle.js'
import { StalePriceError } from '../src/errors.js'

function makeRedisMock() {
  const store = new Map<string, string>()
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string, _ex: string, _ttl: number) => {
      store.set(key, value)
      return 'OK'
    })
  } as unknown as import('ioredis').Redis
}

describe('price oracle', () => {
  it('fetches a live price and caches it in Redis', async () => {
    const redis = makeRedisMock()
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ tether: { usd: 1.001 } }), { status: 200 })
    )

    const result = await getUsdPrice('USDT', { redis, fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(result.source).toBe('live')
    expect(Number(result.usdPrice)).toBeCloseTo(1.001, 6)

    const cached = await getUsdPrice('USDT', { redis, fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(cached.source).toBe('cache')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('prefers a fresh manual override over live/cache', async () => {
    const redis = makeRedisMock()
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ tether: { usd: 1.0 } }), { status: 200 }))
    const setAt = new Date()

    const result = await getUsdPrice('USDT', {
      redis,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getManualOverride: async () => ({ usdPrice: '1.500000', setAt })
    })

    expect(result.source).toBe('override')
    expect(result.usdPrice).toBe('1.500000')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('throws StalePriceError when the manual override is too old', async () => {
    const redis = makeRedisMock()
    const staleSetAt = new Date(Date.now() - 20 * 60 * 1000)

    await expect(
      getUsdPrice('USDT', {
        redis,
        getManualOverride: async () => ({ usdPrice: '1.500000', setAt: staleSetAt })
      })
    ).rejects.toThrow(StalePriceError)
  })
})
