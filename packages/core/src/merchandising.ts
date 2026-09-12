export const FEATURED_PRODUCT_SLUG = 'mirasim'

export interface ProductPromotion {
  featured: boolean
  isNew: boolean
  limited: boolean
  summary: { ru: string; en: string }
  accessNote: { ru: string; en: string }
}

// Product facts checked against https://mirasim.ai on 2026-09-12.
// "Limited" describes invite-only cloud Pro, never an invented stock count or deadline.
const MIRASIM_PROMOTION: ProductPromotion = {
  featured: true,
  isNew: true,
  limited: true,
  summary: {
    ru: 'Claude Code, Codex и AI-агенты в одном рабочем пространстве.',
    en: 'Claude Code, Codex and AI agents in one workspace.'
  },
  accessNote: {
    ru: 'Облачный Pro доступен по приглашениям. Работа со своими аккаунтами в Mirasim бесплатна; здесь продаётся доступ к Pro.',
    en: 'Cloud Pro is invite-only. Using your own accounts in Mirasim is free; this offer is for Pro access.'
  }
}

export function productPromotion(slug: string): ProductPromotion | null {
  return slug === FEATURED_PRODUCT_SLUG ? MIRASIM_PROMOTION : null
}

/** Stable priority: leave the relative order of every other product unchanged. */
export function compareProductPriority(a: { slug: string }, b: { slug: string }): number {
  return Number(b.slug === FEATURED_PRODUCT_SLUG) - Number(a.slug === FEATURED_PRODUCT_SLUG)
}

export function prioritizeProducts<T extends { slug: string }>(products: readonly T[]): T[] {
  return [...products].sort(compareProductPriority)
}

export function prioritizeCatalog<T extends { products: { slug: string }[] }>(categories: readonly T[]): T[] {
  return categories.map(category => ({ ...category, products: prioritizeProducts(category.products) }))
    .sort((a, b) => Number(b.products.some(p => p.slug === FEATURED_PRODUCT_SLUG)) - Number(a.products.some(p => p.slug === FEATURED_PRODUCT_SLUG)))
}

export function mirasimProductLink(miniappUrl: string, botUsername?: string): string {
  const username = botUsername?.trim().replace(/^@/, '')
  return username && /^[a-zA-Z0-9_]{5,32}$/.test(username)
    ? `https://t.me/${username}?start=product_${FEATURED_PRODUCT_SLUG}`
    : `${miniappUrl.replace(/\/+$/, '')}/product/${FEATURED_PRODUCT_SLUG}`
}

/** Reviewable campaign copy. This function neither persists nor sends a message. */
export function mirasimAnnouncement(productUrl: string, locale: 'ru' | 'en' = 'ru'): string {
  const promotion = MIRASIM_PROMOTION
  return locale === 'ru' ? [
    'Mirasim Pro — новинка и выбор нашего магазина',
    '',
    promotion.summary.ru,
    'Несколько проектов, моделей и сессий в одном IDE — от разработки с агентами до проверки результата.',
    '',
    'Лимитированный доступ: облачный Pro по приглашениям.',
    'Работа со своими аккаунтами в Mirasim бесплатна. Наше предложение — доступ к облачному Pro с ручным оформлением.',
    '',
    'Посмотреть актуальные тарифы и условия:',
    productUrl
  ].join('\n') : [
    'Mirasim Pro — new in store and our featured pick',
    '',
    promotion.summary.en,
    'Manage projects, models and sessions in one IDE — from building with agents to evaluating the result.',
    '',
    'Limited access: cloud Pro is invite-only.',
    'Using your own accounts in Mirasim is free. Our offer is cloud Pro access, arranged manually.',
    '',
    'See current plans and terms:',
    productUrl
  ].join('\n')
}
