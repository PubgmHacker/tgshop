import { Bot, GrammyError, HttpError } from 'grammy'
import type { BotContext } from '../context.js'
import { logger } from '../../lib/logger.js'
import { env } from '../../config/env.js'
import { t } from '../../i18n/index.js'

/**
 * Global error boundary: logs full details to pino (Sentry-compatible sink —
 * point SENTRY_DSN transport at the same stream in prod), notifies the admin
 * chat, and always replies to the user with a translated, stack-trace-free message.
 */
export function registerErrorHandler(bot: Bot<BotContext>): void {
  bot.catch((botError) => {
    const { ctx, error } = botError
    const correlationId = Math.random().toString(36).slice(2, 10)

    if (error instanceof GrammyError) {
      logger.error({ correlationId, err: error, description: error.description }, 'grammY API error')
    } else if (error instanceof HttpError) {
      logger.error({ correlationId, err: error }, 'grammY transport error')
    } else {
      logger.error({ correlationId, err: error }, 'unhandled bot error')
    }

    void notifyAdmins(bot, correlationId, error).catch((notifyErr) => {
      logger.error({ err: notifyErr }, 'failed to notify admin chat of bot error')
    })

    const locale = ctx.session?.locale ?? 'en'
    void ctx
      .reply(t(locale, 'errors.generic'))
      .catch((replyErr) => logger.error({ err: replyErr }, 'failed to send error reply to user'))
  })
}

async function notifyAdmins(bot: Bot<BotContext>, correlationId: string, error: unknown): Promise<void> {
  if (env.ADMIN_IDS.length === 0) return
  const message = error instanceof Error ? error.message : String(error)
  const text = `⚠️ Bot error [${correlationId}]\n${message}`
  for (const adminId of env.ADMIN_IDS) {
    await bot.api.sendMessage(Number(adminId), text).catch(() => undefined)
  }
}
