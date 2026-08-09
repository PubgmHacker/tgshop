import type { NextFunction } from 'grammy'
import type { BotContext } from '../context.js'
import { redis } from '../../config/redis.js'
import { t } from '../../i18n/index.js'

const LOCK_TTL_MS = 8_000

/**
 * Prevents double-processing when a user double-taps a button or resends a
 * command before the previous action finished. Keyed per user, not per
 * action, so any concurrent action from the same user is serialized —
 * simple and sufficient for a single-process bot.
 */
export function antiDoubleClick() {
  return async (ctx: BotContext, next: NextFunction): Promise<void> => {
    const userId = ctx.from?.id
    if (!userId) {
      await next()
      return
    }

    const lockKey = `lock:action:${userId}`
    const acquired = await redis.set(lockKey, '1', 'PX', LOCK_TTL_MS, 'NX')
    if (!acquired) {
      if (ctx.callbackQuery) {
        await ctx.answerCallbackQuery({ text: t(ctx.session.locale, 'errors.double_click') })
      } else {
        await ctx.reply(t(ctx.session.locale, 'errors.double_click'))
      }
      return
    }

    try {
      await next()
    } finally {
      await redis.del(lockKey)
    }
  }
}
