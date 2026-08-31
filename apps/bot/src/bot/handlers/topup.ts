import type { Bot } from 'grammy'
import { InlineKeyboard } from 'grammy'
import type { Conversation } from '@grammyjs/conversations'
import type { BotContext } from '../context.js'
import { t } from '../../i18n/index.js'
import { displayToCents } from '@tgshop/core'
import { formatUsd } from '../../lib/format.js'
import { PaymentProvider } from '@tgshop/db'
import { getUserByTgId, findOrCreateUser } from '../../domain/users.js'
import { createInvoice } from '../../domain/payments.js'
import { newTopupReference } from '../../domain/topup.js'
import { logger } from '../../lib/logger.js'
import { getTopupLimits } from '../../domain/topup-policy.js'
import { getPaymentAvailability } from '../../domain/payment-availability.js'

// Both type arguments are required: Conversation's second parameter (the inner
// context) defaults to plain Context, which would not match createConversation's
// ConversationBuilder<BotContext, BotContext>.
export async function topupConversation(
  conversation: Conversation<BotContext, BotContext>,
  ctx: BotContext
): Promise<void> {
  // Session lives only on OUTSIDE context objects: the conversations replay
  // engine rebuilds inner contexts without running outer middleware, so
  // `ctx.session` here is undefined at runtime (the types cannot show that).
  // external() hands its callback the outside context — the one with session.
  const locale = await conversation.external((outerCtx) => outerCtx.session.locale)
  const limits = await conversation.external(() => getTopupLimits())

  const topupProviders = getPaymentAvailability().topupProviders
  if (topupProviders.length === 0) {
    await ctx.reply(t(locale, 'common.error_generic'))
    return
  }
  // CryptoBot remains the preferred chat rail when configured, but Stars is a
  // fully supported fallback. A missing/rotated CryptoBot token must not turn
  // the bot's Top up button into a dead end while Telegram Stars still works.
  const provider = topupProviders.includes('CRYPTOBOT') ? PaymentProvider.CRYPTOBOT : PaymentProvider.STARS

  await ctx.reply(t(locale, 'topup.enter_amount'))
  const amountCtx = await conversation.waitFor('message:text')
  const cents = await conversation.external(() => {
    try {
      return displayToCents(amountCtx.message.text)
    } catch {
      return null
    }
  })

  if (cents === null || cents < limits.minCents || cents > limits.maxCents) {
    await ctx.reply(
      t(locale, 'topup.invalid_amount', {
        min: formatUsd(limits.minCents),
        max: formatUsd(limits.maxCents)
      })
    )
    return
  }

  const reference = await conversation.external(() => newTopupReference())

  try {
    // Must go through createInvoice(), not createCryptoBotInvoice() directly:
    // it writes the Payment row (with this user's id) before the provider can
    // call back, which is what lets the webhook know who to credit.
    const user = await conversation.external(() => getUserByTgId(BigInt(ctx.from?.id ?? 0)))
    if (!user) {
      await ctx.reply(t(locale, 'common.error_generic'))
      return
    }

    const invoice = await conversation.external(() =>
      createInvoice({
        userId: user.id,
        amountCents: cents,
        provider,
        description: 'Balance top-up',
        reference,
        idempotencyKey: `bot-topup:${user.id}:${reference}`
      })
    )

    if (!invoice.payUrl) {
      await ctx.reply(t(locale, 'common.error_generic'))
      return
    }

    await ctx.reply(t(locale, 'topup.created', { amount: formatUsd(cents) }), {
      reply_markup: new InlineKeyboard().url(provider === PaymentProvider.STARS ? '⭐ Pay with Stars' : '💳 Pay', invoice.payUrl)
    })
  } catch (err) {
    await conversation.external(() => logger.error({ err }, 'top-up invoice creation failed'))
    await ctx.reply(t(locale, 'common.error_generic'))
  }
}

export function registerTopupHandlers(bot: Bot<BotContext>): void {
  bot.hears([t('ru', 'menu.topup'), t('en', 'menu.topup')], async (ctx) => {
    const tgUser = ctx.from
    if (!tgUser) return
    const existing = await getUserByTgId(BigInt(tgUser.id))
    if (!existing) {
      await findOrCreateUser({
        tgId: BigInt(tgUser.id),
        username: tgUser.username ?? null,
        firstName: tgUser.first_name ?? null,
        languageCode: tgUser.language_code ?? null
      })
    }
    await ctx.conversation.enter('topup')
  })
}
