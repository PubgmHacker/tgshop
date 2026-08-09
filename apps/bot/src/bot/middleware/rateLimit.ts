import type { NextFunction } from 'grammy'
import type { BotContext } from '../context.js'
import { redis } from '../../config/redis.js'
import { t } from '../../i18n/index.js'

const WINDOW_SECONDS = 10
const MAX_ACTIONS_PER_WINDOW = 15

/** Simple fixed-window per-user rate limit backed by Redis. */
export function rateLimit() {
  return async (ctx: BotContext, next: NextFunction): Promise<void> => {
    const userId = ctx.from?.id
    if (!userId) {
      await next()
      return
    }

    const windowKey = `ratelimit:${userId}:${Math.floor(Date.now() / 1000 / WINDOW_SECONDS)}`
    const count = await redis.incr(windowKey)
    if (count === 1) {
      await redis.expire(windowKey, WINDOW_SECONDS)
    }

    if (count > MAX_ACTIONS_PER_WINDOW) {
      if (ctx.callbackQuery) {
        await ctx.answerCallbackQuery({ text: t(ctx.session.locale, 'errors.rate_limited') })
      } else {
        await ctx.reply(t(ctx.session.locale, 'errors.rate_limited'))
      }
      return
    }

    await next()
  }
}
