import type { Bot } from 'grammy'
import { InlineKeyboard } from 'grammy'
import { prisma, PaymentProvider } from '@tgshop/db'
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
import { readRequiresEmail } from '@tgshop/core'
import { createInvoice, settleStarsPayment } from '../../domain/payments.js'
import { findStarsTopupPayment, settleStarsTopup } from '../../domain/topup.js'
import { emitEvent } from '../../domain/events.js'
import { planPriceToStars } from '../../payments/stars.js'
import { logger } from '../../lib/logger.js'
import { reportProblemKeyboard } from '../keyboards/catalog.js'
import { env } from '../../config/env.js'
import { isPaymentProviderAvailable } from '../../domain/payment-availability.js'

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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const MAX_EMAIL_LENGTH = 254

/** Reply-keyboard captions in every locale; the email prompt must never swallow them. */
const MENU_CAPTIONS: ReadonlySet<string> = new Set(
  (['catalog', 'profile', 'topup', 'purchases', 'referrals', 'faq'] as const).flatMap(
    (key) => [t('ru', `menu.${key}`), t('en', `menu.${key}`)]
  )
)

interface CheckoutParams {
  planId: string
  qty: number
  provider: PaymentProvider
  customerEmail: string | null
}

/**
 * Creates the order and starts the chosen payment rail. Shared by the direct
 * pay-button path and the collect-email-first path (requiresEmail products),
 * so the two can never drift in how an order is priced or invoiced.
 */
async function launchCheckout(ctx: BotContext, params: CheckoutParams): Promise<void> {
  const locale = ctx.session.locale

  const plan = await getPlanById(params.planId)
  if (!plan || !plan.isActive || !plan.product.isActive) {
    await ctx.reply(t(locale, 'common.not_found'))
    return
  }

  if (!isPaymentProviderAvailable(params.provider)) {
    await ctx.reply(t(locale, 'common.error_generic'))
    return
  }

  const user = await requireUser(ctx)
  const idempotencyKey = newIdempotencyKey(`order:${user.id}:${params.planId}`)

  const { order, pricing } = await createOrder({
    userId: user.id,
    planId: params.planId,
    qty: params.qty,
    provider: params.provider,
    promoCode: ctx.session.pendingPromoCode ?? null,
    idempotencyKey,
    customerEmail: params.customerEmail
  })

  // Re-entering a Telegram checkout must not mint a second invoice for an
  // order that is already paid/delivered. Show the existing outcome instead.
  if (order.status !== 'PENDING') {
    await deliverAndNotify(ctx, order.id)
    return
  }

  switch (params.provider) {
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
      try {
        // Create the Payment row before sending the chat invoice. Without this
        // the successful_payment update could charge the user but have no row
        // for settleStarsPayment() to mark as paid.
        const invoice = await createInvoice({
          userId: user.id,
          amountCents: pricing.totalCents,
          provider: PaymentProvider.STARS,
          description: `${plan.product.title} — ${plan.title}`,
          reference: order.id,
          orderId: order.id,
          priceStars: planPriceToStars(plan.priceStars, plan.priceCents, params.qty, pricing.totalCents)
        })
        const stars = invoice.stars
        if (!stars) throw new Error('Stars invoice returned no amount')
        // createInvoice() already creates the Telegram invoice link and the
        // Payment row that successful_payment will settle. Sending a second
        // native invoice here used to leave an orphan link/payment pair and
        // made retries ambiguous. One link, one Payment, one settlement path.
        if (!invoice.payUrl) throw new Error('Stars invoice returned no payUrl')
        await ctx.reply(t(locale, 'order.created', { orderId: order.id }), {
          reply_markup: new InlineKeyboard().url('⭐ Pay with Stars', invoice.payUrl)
        })
      } catch (err) {
        logger.error({ err, orderId: order.id }, 'Stars invoice creation failed')
        await ctx.reply(t(locale, 'common.error_generic'))
      }
      return
    }

    case PaymentProvider.TRON_TRC20: {
      try {
        // Route through the shared invoice creator so the tagged amount and the
        // Payment row are persisted together. A chat checkout that only quoted
        // the address would be invisible to the chain scanner and could never
        // be matched automatically.
        const invoice = await createInvoice({
          userId: user.id,
          amountCents: pricing.totalCents,
          provider: PaymentProvider.TRON_TRC20,
          description: `${plan.product.title} — ${plan.title}`,
          reference: order.id,
          orderId: order.id
        })
        const tron = invoice.tron
        if (!tron) throw new Error('TRON invoice returned no payment instructions')
        await ctx.reply(
          t(locale, 'order.created', { orderId: order.id }) +
            '\n\n' +
            t(locale, 'order.usdt_instructions', {
              amount: tron.amountDisplay,
              address: tron.address,
              minutes: Math.round((new Date(tron.expiresAt).getTime() - Date.now()) / 60_000)
            }),
          { parse_mode: 'HTML' }
        )
      } catch (err) {
        logger.error({ err, orderId: order.id }, 'USDT invoice creation failed')
        await ctx.reply(t(locale, 'common.error_generic'))
      }
      return
    }
  }
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

    // requiresEmail products (delivered by an operator onto the buyer's own
    // account) collect the address BEFORE the order exists, so the admin sees
    // it on the order from the first second it appears in the panel.
    if (readRequiresEmail(plan.product.externalConfig)) {
      ctx.session.checkout = { planId, qty, provider: providerRaw, awaitingEmail: true }
      await ctx.reply(t(locale, 'order.enter_email'))
      return
    }

    await launchCheckout(ctx, {
      planId,
      qty,
      provider: PaymentProvider[providerRaw],
      customerEmail: null
    })
  })

  // The email step parked by the pay button above. Passes anything that is not
  // its own reply straight through (next()), so commands and reply-keyboard
  // buttons registered later keep working even mid-prompt.
  bot.on('message:text', async (ctx, next) => {
    const pending = ctx.session.checkout
    if (!pending?.awaitingEmail) return next()

    const text = ctx.message.text.trim()
    if (text.startsWith('/') || MENU_CAPTIONS.has(text)) {
      // The buyer changed their mind — drop the prompt, run the real handler.
      ctx.session.checkout = undefined
      return next()
    }

    const locale = ctx.session.locale
    if (text.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(text)) {
      await ctx.reply(t(locale, 'order.invalid_email'))
      return
    }

    ctx.session.checkout = undefined
    await ctx.reply(t(locale, 'order.email_accepted', { email: text }))
    await launchCheckout(ctx, {
      planId: pending.planId,
      qty: pending.qty,
      provider: PaymentProvider[pending.provider],
      customerEmail: text
    })
  })

  // Telegram Stars payment flow. The invoice payload is either an Order.id or
  // a `topup_*` balance top-up reference (domain/payments.ts writes both).
  bot.on('pre_checkout_query', async (ctx) => {
    // Must be answered within 10s per Telegram's API contract.
    const payload = ctx.preCheckoutQuery.invoice_payload
    const payer = ctx.from ? await getUserByTgId(BigInt(ctx.from.id)) : null
    const totalStars = ctx.preCheckoutQuery.total_amount

    if (payload.startsWith('topup_')) {
      const topup = await findStarsTopupPayment(payload)
      if (
        !topup ||
        topup.status === 'PAID' ||
        !payer ||
        payer.id !== topup.userId ||
        !Number.isSafeInteger(totalStars) ||
        totalStars <= 0 ||
        topup.amount !== BigInt(totalStars)
      ) {
        await ctx.answerPreCheckoutQuery(false, 'This top-up invoice is no longer valid.')
        return
      }
      await ctx.answerPreCheckoutQuery(true)
      return
    }

    const order = await getOrderById(payload)
    const payment = order
      ? await prisma.payment.findFirst({
          where: { orderId: order.id, provider: PaymentProvider.STARS, status: 'PENDING' },
          orderBy: { createdAt: 'desc' }
        })
      : null
    if (
      !order ||
      order.status !== 'PENDING' ||
      !payer ||
      payer.id !== order.userId ||
      !payment ||
      !Number.isSafeInteger(totalStars) ||
      totalStars <= 0 ||
      payment.amount !== BigInt(totalStars)
    ) {
      await ctx.answerPreCheckoutQuery(false, 'Order is no longer valid.')
      return
    }
    await ctx.answerPreCheckoutQuery(true)
  })

  bot.on('message:successful_payment', async (ctx) => {
    const payment = ctx.message.successful_payment
    const payload = payment.invoice_payload

    if (payload.startsWith('topup_')) {
      // Balance top-up: credit and confirm. settleStarsTopup is repeat-safe
      // (guarded claim + idempotent ledger key), so a redelivered update
      // cannot double-credit.
      try {
        const payer = ctx.from ? await getUserByTgId(BigInt(ctx.from.id)) : null
        if (!payer) {
          logger.error({ reference: payload }, 'Stars top-up update has no known payer')
          return
        }
        const settled = await settleStarsTopup(
          payload,
          payment.telegram_payment_charge_id,
          payment as unknown as object,
          {
            userId: payer.id,
            totalStars: payment.total_amount
          }
        )
        if (settled) {
          await emitEvent('payment.received', {
            paymentId: settled.payment.id,
            orderId: null,
            userId: settled.payment.userId,
            provider: PaymentProvider.STARS,
            amount: settled.payment.amount.toString(),
            asset: settled.payment.asset,
            txHash: payment.telegram_payment_charge_id
          })
          const locale = ctx.session.locale
          await ctx.reply(t(locale, 'topup.credited', { amount: formatUsd(settled.amountCents) }))
        }
      } catch (err) {
        logger.error({ err, reference: payload }, 'failed to settle Stars top-up')
      }
      return
    }

    const orderId = payload

    // Settle the Payment row first, and outside the try below: Telegram has
    // already taken the customer's Stars, so recording that is not conditional
    // on delivery succeeding. Nothing else would ever settle this row — Stars
    // has no reconciler sweep behind it the way CryptoBot and TRON do.
    try {
      const payer = ctx.from ? await getUserByTgId(BigInt(ctx.from.id)) : null
      if (!payer) {
        logger.error({ orderId }, 'Stars payment update has no known payer')
        return
      }
      const settled = await settleStarsPayment(orderId, payment.telegram_payment_charge_id, payment as unknown as object, {
        userId: payer.id,
        totalStars: payment.total_amount
      })
      if (!settled) {
        logger.error({ orderId }, 'rejected Stars payment settlement because payer or amount did not match')
        return
      }
    } catch (err) {
      logger.error({ err, orderId }, 'failed to settle Stars payment row')
      return
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
    for (const adminId of env.ADMIN_IDS) {
      await ctx.api
        .sendMessage(Number(adminId), `⚠️ Problem report for order ${reportedOrderId} from user ${ctx.from?.id}`)
        .catch(() => undefined)
    }
  })
}
