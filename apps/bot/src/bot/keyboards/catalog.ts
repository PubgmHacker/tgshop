import { InlineKeyboard } from 'grammy'
import type { Category, Product, Plan } from '@tgshop/db'
import { formatUsd } from '../../lib/format.js'
import { t, type Locale } from '../../i18n/index.js'

export function categoriesKeyboard(categories: Category[]): InlineKeyboard {
  const kb = new InlineKeyboard()
  for (const category of categories) {
    kb.text(`${category.emoji ?? ''} ${category.title}`.trim(), `cat:${category.slug}`).row()
  }
  return kb
}

export function productsKeyboard(locale: Locale, categorySlug: string, products: Product[]): InlineKeyboard {
  const kb = new InlineKeyboard()
  for (const product of products) {
    kb.text(product.title, `prod:${product.slug}`).row()
  }
  kb.text(t(locale, 'common.back'), 'cat:__back')
  return kb
}

export function plansKeyboard(locale: Locale, productSlug: string, plans: Plan[]): InlineKeyboard {
  const kb = new InlineKeyboard()
  for (const plan of plans) {
    const price = formatUsd(plan.priceCents)
    kb.text(t(locale, 'catalog.plan_button', { title: plan.title, price }), `plan:${plan.id}`).row()
  }
  kb.text(t(locale, 'common.back'), `prod:__back:${productSlug}`)
  return kb
}

export function paymentMethodsKeyboard(locale: Locale, planId: string, qty: number): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(locale, 'order.pay_balance'), `pay:BALANCE:${planId}:${qty}`)
    .row()
    .text(t(locale, 'order.pay_cryptobot'), `pay:CRYPTOBOT:${planId}:${qty}`)
    .row()
    .text(t(locale, 'order.pay_stars'), `pay:STARS:${planId}:${qty}`)
    .row()
    .text(t(locale, 'order.pay_usdt'), `pay:TRON_TRC20:${planId}:${qty}`)
    .row()
    .text(t(locale, 'common.cancel'), 'order:cancel')
}

export function reportProblemKeyboard(locale: Locale, orderId: string): InlineKeyboard {
  return new InlineKeyboard().text(t(locale, 'order.report_problem'), `report:${orderId}`)
}
