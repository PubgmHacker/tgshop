import { Bot, GrammyError, HttpError } from 'grammy'
import type { NextFunction } from 'grammy'
import type { BotContext } from '../context.js'
import { logger } from '../../lib/logger.js'
import { env } from '../../config/env.js'
import { t } from '../../i18n/index.js'

/**
 * Error handling has to work on BOTH update transports:
 *
 *   long polling — bot.start() routes middleware errors to bot.catch.
 *   webhook      — grammY's webhookCallback never calls bot.catch: a thrown
 *                  error becomes the HTTP route's 500, and Telegram then
 *                  retries the SAME update until it expires. One poisoned
 *                  update freezes delivery for every chat behind it.
 *
 * So the real boundary is `errorBoundary`, installed as the FIRST middleware:
 * it reports and swallows, which makes the webhook answer 200 and keeps the
 * update queue moving. bot.catch stays registered as the polling-path catch
 * for anything thrown outside the boundary (nothing should be).
 */
export async function errorBoundary(ctx: BotContext, next: NextFunction): Promise<void> {
  try {
    await next()
  } catch (error) {
    await report(ctx, error)
  }
}

export function registerErrorHandler(bot: Bot<BotContext>): void {
  bot.catch((botError) => {
    void report(botError.ctx, botError.error)
  })
}

async function report(ctx: BotContext, error: unknown): Promise<void> {
  const correlationId = Math.random().toString(36).slice(2, 10)

  if (error instanceof GrammyError) {
    logger.error({ correlationId, err: error, description: error.description }, 'grammY API error')
  } else if (error instanceof HttpError) {
    logger.error({ correlationId, err: error }, 'grammY transport error')
  } else {
    logger.error(
      { correlationId, err: error, updateId: ctx.update?.update_id },
      'unhandled bot error'
    )
  }

  void notifyAdmins(ctx, correlationId, error).catch((notifyErr) => {
    logger.error({ err: notifyErr }, 'failed to notify admin chat of bot error')
  })

  const locale = ctx.session?.locale ?? 'en'

  // A failed pre_checkout_query must still be answered (Telegram gives us 10s),
  // otherwise the buyer's payment sheet hangs and the update is retried.
  if (ctx.preCheckoutQuery) {
    await ctx
      .answerPreCheckoutQuery(false, t(locale, 'errors.generic'))
      .catch((answerErr) => logger.error({ err: answerErr }, 'failed to answer pre_checkout_query after error'))
    return
  }

  // Only updates that belong to a chat can receive a reply (pre_checkout_query
  // and message-less callback_query updates do not).
  if (ctx.chat) {
    await ctx
      .reply(t(locale, 'errors.generic'))
      .catch((replyErr) => logger.error({ err: replyErr }, 'failed to send error reply to user'))
  }
}

async function notifyAdmins(ctx: BotContext, correlationId: string, error: unknown): Promise<void> {
  if (env.ADMIN_IDS.length === 0) return
  const message = error instanceof Error ? error.message : String(error)
  const text = `⚠️ Bot error [${correlationId}]\n${message}`
  for (const adminId of env.ADMIN_IDS) {
    await ctx.api.sendMessage(Number(adminId), text).catch(() => undefined)
  }
}
