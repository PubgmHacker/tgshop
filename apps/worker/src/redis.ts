import { Redis } from 'ioredis'
import { loadEnv } from './env.js'

let connection: Redis | undefined

/** Shared ioredis connection for BullMQ (maxRetriesPerRequest must be null per BullMQ docs). */
export function getRedisConnection(): Redis {
  if (connection) return connection
  const env = loadEnv()
  const created = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true
  })
  connection = created
  return created
}

export async function closeRedisConnection(): Promise<void> {
  if (connection) {
    await connection.quit()
    connection = undefined
  }
}
