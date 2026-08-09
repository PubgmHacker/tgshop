// ioredis is CJS: under NodeNext its default export resolves to the module
// namespace rather than the class, so the default import is not constructable.
// The named export is the same object (`Redis === default` at runtime).
import { Redis } from 'ioredis'
import { env } from './env.js'

// Single shared ioredis connection reused by grammY session storage,
// conversations, rate limiting, anti-double-click locks and BullMQ-adjacent code.
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true
})

redis.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('[redis] connection error', err)
})
