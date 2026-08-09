import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import type { Bot } from 'grammy'
import type { BotContext } from '../bot/context.js'
import { env } from '../config/env.js'
import { registerSecurityPlugins } from './plugins/security.js'
import { registerMetricsPlugin } from './plugins/metrics.js'
import { registerHealthRoute } from './routes/health.js'
import { registerTelegramWebhookRoute } from './routes/telegramWebhook.js'
import { registerCryptoBotWebhookRoute } from './routes/cryptobotWebhook.js'
import { apiRoutes } from './routes/api/index.js'
import { internalRoutes } from './routes/internal/index.js'
import { describeError } from '../lib/httpErrors.js'
import { resolveLocale } from '../i18n/index.js'

// ─────────────────────────────────────────────────────────────────────────────
// Fastify application factory.
//
// Surfaces on one process (docs/ARCHITECTURE.md):
//   /health, /metrics          — ops
//   /webhook/telegram/:secret  — Bot API updates
//   /webhook/cryptobot         — provider webhook (HMAC over the RAW body)
//   /api/*                     — Mini App REST API (Telegram initData -> JWT)
//   /internal/*                — service-to-service (SERVICE_TOKEN bearer)
//
// RAW BODY: registerSecurityPlugins installs a JSON content-type parser that
// stashes the exact received bytes on `req.rawBody` before parsing, because
// routes/cryptobotWebhook.ts must verify its HMAC over those bytes — re-
// serializing the parsed object would change key order/whitespace and break
// every signature. That parser therefore has to be registered BEFORE any route.
// ─────────────────────────────────────────────────────────────────────────────

export async function buildServer(bot: Bot<BotContext>): Promise<FastifyInstance> {
  const app = Fastify({
    // Fastify owns request logging; the pino instance in lib/logger.ts is used
    // by everything else. Same level and redaction policy for both.
    logger: {
      level: env.LOG_LEVEL,
      base: { app: '@tgshop/bot' },
      formatters: {
        level(label: string) {
          return { level: label }
        }
      },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["crypto-pay-api-signature"]',
          'req.body.initData'
        ],
        remove: true
      },
      serializers: {
        req(request: { method: string; url: string; id: string; headers: Record<string, unknown> }) {
          return {
            method: request.method,
            url: request.url,
            correlationId: request.headers['x-correlation-id'] ?? request.id
          }
        }
      }
    },
    // Trust the reverse proxy (Caddy) for client IPs so rate limiting keys on
    // the real caller rather than the proxy's own address.
    trustProxy: true,
    bodyLimit: 1_048_576,
    disableRequestLogging: false
  })

  // Order matters: security first (it installs the raw-body JSON parser and the
  // correlation-id hook that everything downstream logs against).
  await registerSecurityPlugins(app)
  await registerMetricsPlugin(app)

  registerHealthRoute(app)
  registerTelegramWebhookRoute(app, bot)
  registerCryptoBotWebhookRoute(app)

  await app.register(apiRoutes)
  await app.register(internalRoutes)

  // Uniform error envelope for anything a route did not already handle.
  app.setErrorHandler(async (err, req, reply) => {
    const locale = resolveLocale(req.headers['accept-language'])
    const { status, body } = describeError(err, locale)
    if (status >= 500) {
      req.log.error({ err }, 'unhandled route error')
    }
    await reply.code(status).send(body)
  })

  app.setNotFoundHandler(async (req, reply) => {
    const locale = resolveLocale(req.headers['accept-language'])
    await reply.code(404).send({ error: { code: 'NOT_FOUND', message: locale === 'ru' ? 'Не найдено.' : 'Not found.' } })
  })

  return app
}
