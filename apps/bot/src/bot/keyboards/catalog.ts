import { InlineKeyboard } from 'grammy'
import type { Category, Product, Plan } from '@tgshop/db'
import { formatUsd } from '../../lib/format.js'
import { t, type Locale } from '../../i18n/index.js'
import { getPaymentAvailability, type PaymentAvailability } from '../../domain/payment-availability.js'

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

export function paymentMethodsKeyboard(
  locale: Locale,
  planId: string,
  qty: number,
  availability: PaymentAvailability = getPaymentAvailability()
): InlineKeyboard {
  const labels: Record<string, string> = {
    BALANCE: t(locale, 'order.pay_balance'),
    CRYPTOBOT: t(locale, 'order.pay_cryptobot'),
    STARS: t(locale, 'order.pay_stars'),
    TRON_TRC20: t(locale, 'order.pay_usdt')
  }
  const keyboard = new InlineKeyboard()
  for (const provider of availability.orderProviders) {
    keyboard.text(labels[provider] ?? provider, `pay:${provider}:${planId}:${qty}`).row()
  }
  return keyboard.text(t(locale, 'common.cancel'), 'order:cancel')
}

export function reportProblemKeyboard(locale: Locale, orderId: string): InlineKeyboard {
  return new InlineKeyboard().text(t(locale, 'order.report_problem'), `report:${orderId}`)
}
