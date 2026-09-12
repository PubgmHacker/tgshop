import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { allowLoginAttempt } from '../../apps/admin/src/lib/login-limit.js'
const require = createRequire(new URL('../../apps/admin/package.json', import.meta.url))
const { Redis } = require('ioredis')

describe('admin login throttling', () => {
  it('atomically caps concurrent attempts, isolates accounts and expires counters', async () => {
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', { maxRetriesPerRequest: 0 })
    const namespace = `e2e-login-${randomUUID()}`
    try {
      const results = await Promise.all(Array.from({ length: 12 }, () => allowLoginAttempt(redis, 'Owner@Example.test', namespace)))
      expect(results.filter(Boolean)).toHaveLength(10)
      expect(await allowLoginAttempt(redis, 'owner@example.test', namespace)).toBe(false)
      expect(await allowLoginAttempt(redis, 'another@example.test', namespace)).toBe(true)
      const keys = await redis.keys(`${namespace}:*`)
      expect(keys.every((key: string) => !key.includes('@'))).toBe(true)
      for (const key of keys) expect(await redis.ttl(key)).toBeGreaterThan(0)
    } finally {
      const keys = await redis.keys(`${namespace}:*`)
      if (keys.length) await redis.del(...keys)
      await redis.quit()
    }
  })
})
