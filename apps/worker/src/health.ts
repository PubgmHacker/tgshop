import Fastify from 'fastify'
import { prisma } from '@tgshop/db'
import { getRedisConnection } from './redis.js'
import { logger } from './logger.js'
import { loadEnv } from './env.js'

// ─────────────────────────────────────────────────────────────────────────────
// Side-channel HTTP health server. Separate from any queue traffic — used by
// the container orchestrator's liveness/readiness probes.
// ─────────────────────────────────────────────────────────────────────────────

export async function startHealthServer() {
  const env = loadEnv()
  const app = Fastify({ logger: false })

  app.get('/health', async () => {
    return { status: 'ok', ts: new Date().toISOString() }
  })

  app.get('/ready', async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`
      const redis = getRedisConnection()
      const redisOk = redis.status === 'ready' || redis.status === 'connect'
      if (!redisOk) {
        return reply.code(503).send({ status: 'not_ready', reason: 'redis not ready' })
      }
      return { status: 'ready' }
    } catch (err) {
      logger.error({ err }, 'readiness check failed')
      return reply.code(503).send({ status: 'not_ready' })
    }
  })

  await app.listen({ port: env.WORKER_HEALTH_PORT, host: '0.0.0.0' })
  logger.info({ port: env.WORKER_HEALTH_PORT }, 'health server listening')
  return app
}
