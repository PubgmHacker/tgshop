import { Redis } from 'ioredis'
import { getEnv } from './env'

declare global {
  // eslint-disable-next-line no-var
  var __tgshopAdminRedis: Redis | undefined
}

/** Global-cached ioredis client (avoids exhausting connections under Next.js dev HMR). */
export function getRedis(): Redis {
  if (!globalThis.__tgshopAdminRedis) {
    globalThis.__tgshopAdminRedis = new Redis(getEnv().REDIS_URL, {
      maxRetriesPerRequest: null
    })
  }
  return globalThis.__tgshopAdminRedis
}
