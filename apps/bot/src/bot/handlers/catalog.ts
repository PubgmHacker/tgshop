import type { Bot } from 'grammy'
import type { BotContext } from '../context.js'
import { t } from '../../i18n/index.js'
import { formatUsd } from '../../lib/format.js'
import {
  listActiveCategories,
  listActiveProducts,
  getProductBySlug,
  getAvailableStockCount,
  getCategoryBySlug,
  getPlanById
} from '../../domain/catalog.js'
import { categoriesKeyboard, productsKeyboard, plansKeyboard, paymentMethodsKeyboard } from '../keyboards/catalog.js'
import { isPoolBacked } from '../../domain/stock.js'

export async function showCategories(ctx: BotContext): Promise<void> {
  const locale = ctx.session.locale
  const categories = await listActiveCategories()
  if (categories.length === 0) {
    await ctx.reply(t(locale, 'catalog.empty'))
    return
  }
  await ctx.reply(t(locale, 'catalog.title'), { reply_markup: categoriesKeyboard(categories) })
}

export async function showProducts(ctx: BotContext, categorySlug: string): Promise<void> {
  const locale = ctx.session.locale
  const category = await getCategoryBySlug(categorySlug)
  if (!category) {
    await ctx.reply(t(locale, 'common.not_found'))
    return
  }
  const products = await listActiveProducts(category.id)
  if (products.length === 0) {
    await ctx.reply(t(locale, 'catalog.products_empty'))
    return
  }
  await ctx.reply(t(locale, 'catalog.products_title', { category: category.title }), {
    reply_markup: productsKeyboard(locale, categorySlug, products)
  })
}

export async function showProductPlans(ctx: BotContext, productSlug: string): Promise<void> {
  const locale = ctx.session.locale
  const product = await getProductBySlug(productSlug)
  if (!product) {
    await ctx.reply(t(locale, 'common.not_found'))
    return
  }
  if (product.plans.length === 0) {
    await ctx.reply(t(locale, 'catalog.plans_empty'))
    return
  }
  await ctx.reply(t(locale, 'catalog.plans_title', { product: product.title }), {
    reply_markup: plansKeyboard(locale, productSlug, product.plans)
  })
}

export async function showPlanDetails(ctx: BotContext, planId: string): Promise<void> {
  const locale = ctx.session.locale
  const plan = await getPlanById(planId)
  if (!plan || !plan.isActive || !plan.product.isActive) {
    await ctx.reply(t(locale, 'common.not_found'))
    return
  }
  const stock = await getAvailableStockCount(planId)
  const poolBacked = isPoolBacked(plan.product.deliveryType, plan.product.externalConfig)
  const price = formatUsd(
    plan.discountPercent > 0 ? Math.round((plan.priceCents * (100 - plan.discountPercent)) / 100) : plan.priceCents
  )

  await ctx.reply(
    t(locale, 'catalog.plan_details', {
      product: plan.product.title,
      planTitle: plan.title,
      description: plan.product.description,
      price,
      stock: poolBacked ? String(stock) : t(locale, 'catalog.manual_delivery')
    }),
    {
      parse_mode: 'HTML',
      reply_markup:
        !poolBacked || stock > 0 ? paymentMethodsKeyboard(locale, planId, 1) : undefined
    }
  )
  if (poolBacked && stock === 0) {
    await ctx.reply(t(locale, 'catalog.out_of_stock'))
  }
}

export function registerCatalogHandlers(bot: Bot<BotContext>): void {
  bot.hears([t('ru', 'menu.catalog'), t('en', 'menu.catalog')], async (ctx) => {
    await showCategories(ctx)
  })

  bot.callbackQuery(/^cat:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery()
    const slug = ctx.match[1]
    if (slug === undefined) return
    if (slug === '__back') {
      await showCategories(ctx)
      return
    }
    await showProducts(ctx, slug)
  })

  bot.callbackQuery(/^prod:__back:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery()
    await showCategories(ctx)
  })

  bot.callbackQuery(/^prod:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery()
    const productSlug = ctx.match[1]
    if (productSlug === undefined) return
    await showProductPlans(ctx, productSlug)
  })

  bot.callbackQuery(/^plan:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery()
    const planId = ctx.match[1]
    if (planId === undefined) return
    await showPlanDetails(ctx, planId)
  })
}
