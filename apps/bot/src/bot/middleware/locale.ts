import type { NextFunction } from 'grammy'
import type { BotContext } from '../context.js'
import { resolveLocale } from '../../i18n/index.js'

/** Sets ctx.session.locale from the Telegram user's languageCode on first contact. */
export async function localeMiddleware(ctx: BotContext, next: NextFunction): Promise<void> {
  if (ctx.from?.language_code) {
    ctx.session.locale = resolveLocale(ctx.from.language_code)
  }
  await next()
}
