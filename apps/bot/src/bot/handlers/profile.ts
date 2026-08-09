import type { Bot } from 'grammy'
import type { BotContext } from '../context.js'
import { t } from '../../i18n/index.js'
import { formatUsd } from '../../lib/format.js'
import { getUserByTgId, getUserBalance, getUserTotalSpentCents, getReferralStats, buildReferralLink } from '../../domain/users.js'
import { listUserSubscriptions, listUserOrders } from '../../domain/orders.js'
import { env } from '../../config/env.js'

export function registerProfileHandlers(bot: Bot<BotContext>): void {
  bot.hears([t('ru', 'menu.profile'), t('en', 'menu.profile')], async (ctx) => {
    const locale = ctx.session.locale
    const user = await getUserByTgId(BigInt(ctx.from?.id ?? 0))
    if (!user) {
      await ctx.reply(t(locale, 'common.not_found'))
      return
    }

    const [balance, totalSpent, subscriptions, referralStats] = await Promise.all([
      getUserBalance(user.id),
      getUserTotalSpentCents(user.id),
      listUserSubscriptions(user.id),
      getReferralStats(user.id)
    ])

    const activeSubs = subscriptions.filter((s) => s.status === 'ACTIVE')
    const subsText =
      activeSubs.length > 0
        ? activeSubs.map((s) => `• ${s.plan.product.title} — до ${s.expiresAt.toISOString().slice(0, 10)}`).join('\n')
        : t(locale, 'profile.no_subscriptions')

    await ctx.reply(
      t(locale, 'profile.title', {
        balance: formatUsd(balance),
        totalSpent: formatUsd(totalSpent),
        subscriptions: subsText,
        refLink: buildReferralLink(env.BOT_USERNAME, user.tgId),
        refEarnings: formatUsd(referralStats.earningsCents)
      }),
      { parse_mode: 'HTML' }
    )
  })

  bot.hears([t('ru', 'menu.purchases'), t('en', 'menu.purchases')], async (ctx) => {
    const locale = ctx.session.locale
    const user = await getUserByTgId(BigInt(ctx.from?.id ?? 0))
    if (!user) {
      await ctx.reply(t(locale, 'common.not_found'))
      return
    }
    const orders = await listUserOrders(user.id)
    if (orders.length === 0) {
      await ctx.reply(t(locale, 'purchases.empty'))
      return
    }
    const lines = orders.map((o) =>
      t(locale, 'purchases.item', {
        orderId: o.id,
        product: o.plan.product.title,
        status: o.status,
        date: o.createdAt.toISOString().slice(0, 10)
      })
    )
    await ctx.reply(`${t(locale, 'purchases.title')}\n\n${lines.join('\n')}`, { parse_mode: 'HTML' })
  })

  bot.hears([t('ru', 'menu.referrals'), t('en', 'menu.referrals')], async (ctx) => {
    const locale = ctx.session.locale
    const user = await getUserByTgId(BigInt(ctx.from?.id ?? 0))
    if (!user) {
      await ctx.reply(t(locale, 'common.not_found'))
      return
    }
    const stats = await getReferralStats(user.id)
    await ctx.reply(
      t(locale, 'referrals.title', {
        refLink: buildReferralLink(env.BOT_USERNAME, user.tgId),
        count: stats.count,
        earnings: formatUsd(stats.earningsCents)
      }),
      { parse_mode: 'HTML' }
    )
  })

  bot.hears([t('ru', 'menu.faq'), t('en', 'menu.faq')], async (ctx) => {
    const locale = ctx.session.locale
    const items =
      locale === 'ru'
        ? '1. Как оплатить заказ? — Выберите способ оплаты при оформлении.\n2. Как получить товар? — Сразу после оплаты бот отправит данные в этот чат.\n3. Что делать при проблеме? — Нажмите «Сообщить о проблеме» под сообщением с доставкой.'
        : '1. How do I pay? — Pick a payment method at checkout.\n2. How do I receive my item? — The bot delivers it to this chat right after payment.\n3. Something went wrong? — Tap "Report a problem" under the delivery message.'
    await ctx.reply(t(locale, 'faq.title', { items }), { parse_mode: 'HTML' })
  })
}
