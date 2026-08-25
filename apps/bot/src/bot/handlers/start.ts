import type { Bot } from 'grammy'
import type { BotContext } from '../context.js'
import { mainMenuKeyboard, openShopKeyboard } from '../keyboards/menu.js'
import { t } from '../../i18n/index.js'
import { findOrCreateUser } from '../../domain/users.js'

/** Parses grammY's `/start <payload>` deep-link payload into structured intent. */
function parseStartPayload(payload: string | undefined): {
  productSlug?: string
  referrerTgId?: bigint
  promoCode?: string
} {
  if (!payload) return {}
  if (payload.startsWith('product_')) return { productSlug: payload.slice('product_'.length) }
  if (payload.startsWith('ref_')) {
    const raw = payload.slice('ref_'.length)
    try {
      return { referrerTgId: BigInt(raw) }
    } catch {
      return {}
    }
  }
  if (payload.startsWith('promo_')) return { promoCode: payload.slice('promo_'.length) }
  return {}
}

export function registerStartHandler(bot: Bot<BotContext>): void {
  bot.command('start', async (ctx) => {
    const tgUser = ctx.from
    if (!tgUser) return

    const payload = ctx.match?.toString().trim() || undefined
    const intent = parseStartPayload(payload)

    const user = await findOrCreateUser({
      tgId: BigInt(tgUser.id),
      username: tgUser.username ?? null,
      firstName: tgUser.first_name ?? null,
      languageCode: tgUser.language_code ?? null,
      referredByTgId: intent.referrerTgId ?? null
    })

    const locale = ctx.session.locale

    await ctx.reply(t(locale, 'start.welcome', { shopName: 'AI Access Rage' }), {
      reply_markup: mainMenuKeyboard(locale),
      parse_mode: 'HTML'
    })

    // Separate message because one message carries one reply_markup, and the
    // welcome already installs the reply keyboard. Inline web_app buttons are
    // the launch path that receives initData.
    await ctx.reply(t(locale, 'start.open_shop'), {
      reply_markup: openShopKeyboard(locale)
    })

    if (intent.referrerTgId) {
      await ctx.reply(t(locale, 'start.referral_applied'))
    }
    if (intent.promoCode) {
      ctx.session.pendingPromoCode = intent.promoCode
      await ctx.reply(t(locale, 'start.promo_applied', { code: intent.promoCode }))
    }
    if (intent.productSlug) {
      // Route straight into the product view via a synthetic callback-like flow.
      await ctx.api.sendChatAction(tgUser.id, 'typing')
    }

    void user
  })
}
