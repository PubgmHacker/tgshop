import type { Bot, NextFunction } from 'grammy'
import { InlineKeyboard } from 'grammy'
import { prisma, OrderStatus, LedgerType } from '@tgshop/db'
import { credit, refundOrder } from '@tgshop/core'
import type { BotContext } from '../context.js'
import { t } from '../../i18n/index.js'
import { env, isAdminId } from '../../config/env.js'
import { formatUsd } from '../../lib/format.js'
import { getBalance } from '@tgshop/core'
import { encryptStockPayload } from '../../domain/orders.js'
import { logger } from '../../lib/logger.js'
import { versionedWebAppUrl } from '../webAppUrls.js'
import { createPost, publishPost } from '../../domain/content.js'

async function adminGuard(ctx: BotContext, next: NextFunction): Promise<void> {
  const tgId = ctx.from?.id
  if (!tgId || !isAdminId(BigInt(tgId))) {
    await ctx.reply(t(ctx.session.locale, 'admin.not_authorized'))
    return
  }
  await next()
}

export function registerAdminHandlers(bot: Bot<BotContext>): void {
  bot.command('admin', adminGuard, async (ctx) => {
    // With ADMIN_MINIAPP_URL configured, /admin opens the Admin Mini App; the
    // web_app button only works over HTTPS, so a plain-HTTP dev URL falls back
    // to the text panel like an unset one.
    const adminAppUrl = env.ADMIN_MINIAPP_URL
    if (adminAppUrl?.startsWith('https://')) {
      await ctx.reply(t(ctx.session.locale, 'admin.panel'), {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().webApp(
          t(ctx.session.locale, 'admin.open_panel'),
          versionedWebAppUrl(adminAppUrl)
        )
      })
      return
    }
    await ctx.reply(t(ctx.session.locale, 'admin.panel'), { parse_mode: 'HTML' })
  })

  bot.command('stats', adminGuard, async (ctx) => {
    const locale = ctx.session.locale
    const [users, orders, revenue] = await Promise.all([
      prisma.user.count(),
      prisma.order.count(),
      prisma.order.aggregate({ where: { status: OrderStatus.DELIVERED }, _sum: { amountCents: true } })
    ])
    await ctx.reply(
      t(locale, 'admin.stats', {
        users,
        orders,
        revenue: formatUsd(revenue._sum.amountCents ?? 0)
      }),
      { parse_mode: 'HTML' }
    )
  })

  bot.command('addstock', adminGuard, async (ctx) => {
    const locale = ctx.session.locale
    const args = ctx.match?.toString().trim().split(/\s+/) ?? []
    const [planId, ...payloadParts] = args
    const payload = payloadParts.join(' ')
    if (!planId || !payload) {
      await ctx.reply(t(locale, 'admin.usage_addstock'))
      return
    }
    const plan = await prisma.plan.findUnique({ where: { id: planId } })
    if (!plan) {
      await ctx.reply(t(locale, 'common.not_found'))
      return
    }
    await prisma.stockItem.create({
      data: { planId, payloadEnc: encryptStockPayload(payload) }
    })
    await ctx.reply(t(locale, 'admin.stock_added', { planId }))
  })

  bot.command('broadcast', adminGuard, async (ctx) => {
    const locale = ctx.session.locale
    const text = ctx.match?.toString().trim() ?? ''
    if (!text) {
      await ctx.reply(t(locale, 'admin.usage_broadcast'))
      return
    }
    const recipientCount = await prisma.user.count({ where: { isBlocked: false } })
    const post = await createPost({ text, segment: 'all' })
    await publishPost(post.id)
    await ctx.reply(t(locale, 'admin.broadcast_scheduled', { count: recipientCount }))
  })

  bot.command('user', adminGuard, async (ctx) => {
    const locale = ctx.session.locale
    const arg = ctx.match?.toString().trim()
    if (!arg) {
      await ctx.reply(t(locale, 'admin.usage_user'))
      return
    }
    let targetTgId: bigint
    try {
      targetTgId = BigInt(arg)
    } catch {
      await ctx.reply(t(locale, 'admin.usage_user'))
      return
    }
    const user = await prisma.user.findUnique({ where: { tgId: targetTgId } })
    if (!user) {
      await ctx.reply(t(locale, 'admin.user_not_found'))
      return
    }
    const balance = await getBalance(prisma, user.id)
    await ctx.reply(
      t(locale, 'admin.user_info', {
        id: user.id,
        tgId: user.tgId.toString(),
        username: user.username ?? '—',
        balance: formatUsd(balance),
        blocked: user.isBlocked ? t(locale, 'common.yes') : t(locale, 'common.no')
      })
    )
  })

  bot.command('refund', adminGuard, async (ctx) => {
    const locale = ctx.session.locale
    const orderId = ctx.match?.toString().trim()
    if (!orderId) {
      await ctx.reply(t(locale, 'admin.usage_refund'))
      return
    }
    const order = await prisma.order.findUnique({ where: { id: orderId } })
    if (!order) {
      await ctx.reply(t(locale, 'common.not_found'))
      return
    }
    try {
      // Route through core so the refund gets the state-machine check, stock and
      // promo release, and the shared "return the money at most once" guard. The
      // hand-rolled credit+update this replaced skipped all three: it double-paid
      // an already auto-refunded FAILED order and would even refund an unpaid one.
      await prisma.$transaction((tx) =>
        refundOrder(tx, order.id, `admin /refund by tg:${ctx.from?.id ?? 'unknown'}`)
      )
      await ctx.reply(t(locale, 'admin.refund_done', { orderId }))
    } catch (err) {
      logger.error({ err, orderId }, 'refund failed')
      await ctx.reply(t(locale, 'common.error_generic'))
    }
  })

  bot.command('grant', adminGuard, async (ctx) => {
    const locale = ctx.session.locale
    const args = ctx.match?.toString().trim().split(/\s+/) ?? []
    const [userId, amountStr] = args
    const amountCents = amountStr ? Math.round(Number.parseFloat(amountStr) * 100) : NaN
    if (!userId || !Number.isFinite(amountCents) || amountCents <= 0) {
      await ctx.reply(t(locale, 'admin.usage_grant'))
      return
    }
    try {
      await prisma.$transaction(async (tx) => {
        await credit(tx, {
          userId,
          amountCents,
          type: LedgerType.ADMIN_ADJUST,
          idempotencyKey: `admin-grant:${userId}:${Date.now()}`
        })
      })
      await ctx.reply(t(locale, 'admin.grant_done', { userId, amount: formatUsd(amountCents) }))
    } catch (err) {
      logger.error({ err, userId }, 'admin grant failed')
      await ctx.reply(t(locale, 'common.error_generic'))
    }
  })
}
