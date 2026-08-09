import type { FastifyInstance } from 'fastify'
import { prisma } from '@tgshop/db'
import { redis } from '../../config/redis.js'

export function registerHealthRoute(app: FastifyInstance): void {
  app.get('/health', async (_req, reply) => {
    const checks: Record<string, 'ok' | 'error'> = { db: 'ok', redis: 'ok' }

    try {
      await prisma.$queryRaw`SELECT 1`
    } catch {
      checks.db = 'error'
    }

    try {
      await redis.ping()
    } catch {
      checks.redis = 'error'
    }

    const healthy = Object.values(checks).every((v) => v === 'ok')
    reply.code(healthy ? 200 : 503)
    return { status: healthy ? 'ok' : 'degraded', checks }
  })
}
