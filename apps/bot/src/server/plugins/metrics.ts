import { timingSafeEqual } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import client from 'prom-client'
import { env } from '../../config/env.js'

export const metricsRegistry = new client.Registry()
client.collectDefaultMetrics({ register: metricsRegistry })

export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  registers: [metricsRegistry]
})

export async function registerMetricsPlugin(app: FastifyInstance): Promise<void> {
  app.addHook('onResponse', (req, reply, done) => {
    const route = req.routeOptions?.url ?? req.url
    httpRequestDuration.observe(
      { method: req.method, route, status_code: String(reply.statusCode) },
      reply.elapsedTime / 1000
    )
    done()
  })

  app.get('/metrics', async (req, reply) => {
    const expected = Buffer.from(`Bearer ${env.SERVICE_TOKEN}`)
    const received = req.headers.authorization ? Buffer.from(req.headers.authorization) : Buffer.alloc(0)
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      return reply.code(401).header('www-authenticate', 'Bearer').send({ error: 'unauthorized' })
    }
    reply.header('Content-Type', metricsRegistry.contentType)
    return metricsRegistry.metrics()
  })
}
