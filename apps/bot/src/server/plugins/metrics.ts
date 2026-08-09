import type { FastifyInstance } from 'fastify'
import client from 'prom-client'

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

  app.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', metricsRegistry.contentType)
    return metricsRegistry.metrics()
  })
}
