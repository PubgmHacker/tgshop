import { createHash } from 'node:crypto'
import type { Redis } from 'ioredis'

// One atomic counter per account and a short global budget. Keys contain no
// email addresses. A cache outage refuses sign-in instead of bypassing limits.
const COUNTER = `local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end; return n`

export async function allowLoginAttempt(redis: Redis, identity: string, namespace = 'tgshop:admin:login'): Promise<boolean> {
  const digest = createHash('sha256').update(identity.trim().toLowerCase()).digest('hex')
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const counts = await Promise.race([
      Promise.all([
        redis.eval(COUNTER, 1, `${namespace}:global`, 60),
        redis.eval(COUNTER, 1, `${namespace}:account:${digest}`, 900)
      ]),
      new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('login limiter timeout')), 3000) })
    ])
    return Number(counts[0]) <= 300 && Number(counts[1]) <= 10
  } catch { return false }
  finally { if (timeout) clearTimeout(timeout) }
}
