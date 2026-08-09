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

const MIN_TOPUP_CENTS = 100 // $1.00
const MAX_TOPUP_CENTS = 500_000 // $5,000

// Both type arguments are required: Conversation's second parameter (the inner
// context) defaults to plain Context, which would not match createConversation's
// ConversationBuilder<BotContext, BotContext>.
export async function topupConversation(
  conversation: Conversation<BotContext, BotContext>,
  ctx: BotContext
): Promise<void> {
  const locale = ctx.session.locale

  await ctx.reply(t(locale, 'topup.enter_amount'))
  const amountCtx = await conversation.waitFor('message:text')
  const cents = await conversation.external(() => {
    try {
      return displayToCents(amountCtx.message.text)
    } catch {
      return null
    }
  })

  if (cents === null || cents < MIN_TOPUP_CENTS || cents > MAX_TOPUP_CENTS) {
    await ctx.reply(
      t(locale, 'topup.invalid_amount', {
        min: formatUsd(MIN_TOPUP_CENTS),
        max: formatUsd(MAX_TOPUP_CENTS)
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
        provider: PaymentProvider.CRYPTOBOT,
        description: 'Balance top-up',
        reference
      })
    )

    if (!invoice.payUrl) {
      await ctx.reply(t(locale, 'common.error_generic'))
      return
    }

    await ctx.reply(t(locale, 'topup.created', { amount: formatUsd(cents) }), {
      reply_markup: new InlineKeyboard().url('💳 Pay', invoice.payUrl)
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
