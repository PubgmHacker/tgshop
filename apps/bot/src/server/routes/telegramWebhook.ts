import type { FastifyInstance } from 'fastify'
import { webhookCallback } from 'grammy'
import type { Bot } from 'grammy'
import type { BotContext } from '../../bot/context.js'
import { env } from '../../config/env.js'
import { safeEqual } from '@tgshop/core'
import { toApiErrorBody } from '../../lib/httpErrors.js'
import { resolveLocale } from '../../i18n/index.js'

export function registerTelegramWebhookRoute(app: FastifyInstance, bot: Bot<BotContext>): void {
  const callback = webhookCallback(bot, 'fastify')

  app.post('/webhook/telegram/:secret', async (req, reply) => {
    const { secret } = req.params as { secret: string }
    if (!safeEqual(secret, env.WEBHOOK_SECRET)) {
      await reply.code(401).send(toApiErrorBody('UNAUTHORIZED', resolveLocale(req.headers['accept-language']), 'api.errors.unauthorized'))
      return
    }
    await callback(req, reply)
  })
}
