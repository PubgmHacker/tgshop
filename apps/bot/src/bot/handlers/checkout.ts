import type { Bot } from 'grammy'
import { InlineKeyboard } from 'grammy'
import { PaymentProvider } from '@tgshop/db'
import type { BotContext } from '../context.js'
import { t } from '../../i18n/index.js'
import { formatUsd } from '../../lib/format.js'
import { getPlanById } from '../../domain/catalog.js'
import { getUserByTgId, getUserBalance, findOrCreateUser } from '../../domain/users.js'
import {
  createOrder,
  payOrderFromBalance,
  decryptDeliveredPayload,
  creditReferralBonusIfEligible,
  newIdempotencyKey,
  getOrderById,
  markOrderPaidAndDeliver
} from '../../domain/orders.js'
import { createInvoice, settleStarsPayment } from '../../domain/payments.js'
import { amountCentsToStars } from '../../payments/stars.js'
import { allocateDepositAddress } from '../../payments/tron.js'
import { logger } from '../../lib/logger.js'
import { reportProblemKeyboard } from '../keyboards/catalog.js'
import { env } from '../../config/env.js'

async function requireUser(ctx: BotContext) {
  if (!ctx.from) throw new Error('no ctx.from')
  const existing = await getUserByTgId(BigInt(ctx.from.id))
  if (existing) return existing
  return findOrCreateUser({
    tgId: BigInt(ctx.from.id),
    username: ctx.from.username ?? null,
    firstName: ctx.from.first_name ?? null,
    languageCode: ctx.from.language_code ?? null
  })
}

async function deliverAndNotify(ctx: BotContext, orderId: string): Promise<void> {
  const locale = ctx.session.locale
  const order = await getOrderById(orderId)
  if (!order) return

  if (order.status === 'DELIVERED') {
    const payload = decryptDeliveredPayload(order)
    await ctx.reply(`${t(locale, 'order.delivery_caption', { orderId: order.id })}\n\n<span class="tg-spoiler"><code>${escapeHtml(payload)}</code></span>${t(locale, 'order.delivery_footer')}`, {
      parse_mode: 'HTML',
      reply_markup: reportProblemKeyboard(locale, order.id)
    })
    await creditReferralBonusIfEligible(order).catch((err) =>
      logger.error({ err, orderId: order.id }, 'failed to credit referral bonus')
    )
    return
  }

  if (order.status === 'FAILED') {
    await ctx.reply(t(locale, 'order.stock_unavailable'))
    return
  }

  // DELIVERING (external/manual) or otherwise not yet finished — worker will complete it.
  await ctx.reply(t(locale, 'order.paid_processing'))
}

function escapeHtml(input: string): string {
  return input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function registerCheckoutHandlers(bot: Bot<BotContext>): void {
  bot.callbackQuery('order:cancel', async (ctx) => {
    await ctx.answerCallbackQuery()
    await ctx.reply(t(ctx.session.locale, 'order.cancelled'))
  })

  bot.callbackQuery(/^pay:(BALANCE|CRYPTOBOT|STARS|TRON_TRC20):([^:]+):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery()
    const locale = ctx.session.locale
    const [, providerMatch, planMatch, qtyMatch] = ctx.match
    if (providerMatch === undefined || planMatch === undefined || qtyMatch === undefined) return
    const providerRaw = providerMatch as keyof typeof PaymentProvider
    const planId = planMatch
    const qty = Number.parseInt(qtyMatch, 10)

    const plan = await getPlanById(planId)
    if (!plan) {
      await ctx.reply(t(locale, 'common.not_found'))
      return
    }

    const user = await requireUser(ctx)
    const provider = PaymentProvider[providerRaw]
    const idempotencyKey = newIdempotencyKey(`order:${user.id}:${planId}`)

    const { order, pricing } = await createOrder({
      userId: user.id,
      planId,
      qty,
      provider,
      promoCode: ctx.session.pendingPromoCode ?? null,
      idempotencyKey
    })

    switch (provider) {
      case PaymentProvider.BALANCE: {
        const balance = await getUserBalance(user.id)
        if (balance < pricing.totalCents) {
          await ctx.reply(t(locale, 'order.insufficient_balance'))
          return
        }
        await ctx.reply(t(locale, 'order.created', { orderId: order.id }))
        try {
          await payOrderFromBalance(order)
        } catch (err) {
          logger.error({ err, orderId: order.id }, 'balance payment failed')
        }
        await deliverAndNotify(ctx, order.id)
        return
      }

      case PaymentProvider.CRYPTOBOT: {
        try {
          // Via createInvoice() so the order gets a PENDING Payment row the
          // reconciler can match, rather than only settling on a live webhook.
          const invoice = await createInvoice({
            userId: user.id,
            amountCents: pricing.totalCents,
            provider: PaymentProvider.CRYPTOBOT,
            description: `${plan.product.title} — ${plan.title}`,
            reference: order.id,
            orderId: order.id
          })
          if (!invoice.payUrl) throw new Error('CryptoBot invoice returned no payUrl')
          await ctx.reply(t(locale, 'order.created', { orderId: order.id }), {
            reply_markup: new InlineKeyboard().url('💳 Pay', invoice.payUrl)
          })
        } catch (err) {
          logger.error({ err, orderId: order.id }, 'CryptoBot invoice creation failed')
          await ctx.reply(t(locale, 'common.error_generic'))
        }
        return
      }

      case PaymentProvider.STARS: {
        const stars = amountCentsToStars(pricing.totalCents)
        await ctx.api.sendInvoice(ctx.chat?.id ?? ctx.from?.id ?? 0, `${plan.product.title} — ${plan.title}`, plan.product.description, order.id, 'XTR', [
          { label: plan.title, amount: stars }
        ])
        return
      }

      case PaymentProvider.TRON_TRC20: {
        try {
          const address = await allocateDepositAddress(user.id, order.id)
          await ctx.reply(
            t(locale, 'order.created', { orderId: order.id }) +
              `\n\nSend ${formatUsd(pricing.totalCents)} worth of USDT (TRC-20) to:\n<code>${address}</code>`,
            { parse_mode: 'HTML' }
          )
        } catch (err) {
          logger.error({ err, orderId: order.id }, 'USDT deposit address allocation failed')
          await ctx.reply(t(locale, 'common.error_generic'))
        }
        return
      }
    }
  })

  // Telegram Stars payment flow
  bot.on('pre_checkout_query', async (ctx) => {
    // Must be answered within 10s per Telegram's API contract.
    const orderId = ctx.preCheckoutQuery.invoice_payload
    const order = await getOrderById(orderId)
    if (!order || order.status !== 'PENDING') {
      await ctx.answerPreCheckoutQuery(false, 'Order is no longer valid.')
      return
    }
    await ctx.answerPreCheckoutQuery(true)
  })

  bot.on('message:successful_payment', async (ctx) => {
    const payment = ctx.message.successful_payment
    const orderId = payment.invoice_payload

    // Settle the Payment row first, and outside the try below: Telegram has
    // already taken the customer's Stars, so recording that is not conditional
    // on delivery succeeding. Nothing else would ever settle this row — Stars
    // has no reconciler sweep behind it the way CryptoBot and TRON do.
    try {
      await settleStarsPayment(orderId, payment.telegram_payment_charge_id, payment as unknown as object)
    } catch (err) {
      logger.error({ err, orderId }, 'failed to settle Stars payment row')
    }

    try {
      await markOrderPaidAndDeliver(orderId)
    } catch (err) {
      logger.error({ err, orderId }, 'failed to mark Stars order paid/delivered')
    }
    await deliverAndNotify(ctx, orderId)
  })

  bot.callbackQuery(/^report:(.+)$/, async (ctx) => {
    const reportedOrderId = ctx.match[1]
    if (reportedOrderId === undefined) return
    await ctx.answerCallbackQuery({
      text: t(ctx.session.locale, 'order.report_received', { orderId: reportedOrderId })
    })
    const locale = ctx.session.locale
    for (const adminId of env.ADMIN_IDS) {
      await ctx.api
        .sendMessage(Number(adminId), `⚠️ Problem report for order ${reportedOrderId} from user ${ctx.from?.id}`)
        .catch(() => undefined)
    }
    void locale
  })
}
