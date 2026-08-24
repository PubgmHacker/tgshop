import type { FastifyInstance } from 'fastify'
import helmet from '@fastify/helmet'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import { env } from '../../config/env.js'

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string
  }
}

export async function registerSecurityPlugins(app: FastifyInstance): Promise<void> {
  await app.register(helmet, { global: true })

  const allowedOrigins = new Set([env.MINIAPP_URL, env.ADMIN_URL, env.LANDING_URL])
  if (env.ADMIN_MINIAPP_URL) allowedOrigins.add(env.ADMIN_MINIAPP_URL)
  await app.register(cors, {
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true)
        return
      }
      callback(new Error('Not allowed by CORS'), false)
    },
    credentials: true
  })

  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute'
  })

  // Preserve the raw request body for CryptoBot webhooks so HMAC signature
  // verification can run over the exact bytes Telegram/CryptoBot sent.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    try {
      const raw = body.toString('utf8')
      req.rawBody = raw
      const parsed = raw.length > 0 ? JSON.parse(raw) : {}
      done(null, parsed)
    } catch (err) {
      done(err as Error, undefined)
    }
  })

  app.addHook('onRequest', (req, _reply, done) => {
    // Correlation id for structured logging; grabbed from an inbound header when
    // present (e.g. set by an upstream proxy) so traces line up end to end.
    req.headers['x-correlation-id'] = req.headers['x-correlation-id'] ?? req.id
    done()
  })
}
