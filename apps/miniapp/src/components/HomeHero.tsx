'use client'

import Link from 'next/link'
import { useI18n } from '@/i18n/I18nProvider'
import { formatCents } from '@/lib/format'
import { triggerHaptic } from '@/lib/TelegramProvider'
import type { ProductSummary } from '@/types/api'
import { BrandMark } from './BrandMark'
import { ProductBadges } from './ProductBadges'

export function HomeHero({
  balanceCents,
  isLoading = false,
  featured
}: {
  balanceCents: number | null
  isLoading?: boolean
  featured?: ProductSummary
}): JSX.Element {
  const { t, locale } = useI18n()
  const cents = balanceCents ?? 0
  const promotion = featured?.promotion

  return (
    <section className="glass glass-live overflow-hidden rounded-[28px] px-5 py-6">
      <span className="glass-sheen" aria-hidden />
      <p className="chip relative inline-flex rounded-full px-2.5 py-1 text-[12px] font-semibold text-ink">
        {t('card.balance')} · {isLoading ? '—' : formatCents(cents)}
      </p>
      <div className="relative mt-4 flex items-center justify-between gap-4">
        <h1 className="text-[30px] font-bold leading-[1.12] tracking-[-0.03em] text-ink">
          {featured ? featured.title : t('home.hero.title')}
        </h1>
        {featured ? <span className="mark-plate flex h-16 w-16 shrink-0 items-center justify-center rounded-[18px]"><BrandMark slug={featured.slug} size={42} /></span> : null}
      </div>
      {promotion ? <div className="relative mt-3"><ProductBadges promotion={promotion} /></div> : null}
      <p className="relative mt-2 text-[15px] leading-relaxed text-muted">{promotion ? promotion.summary[locale] : t('home.hero.sub')}</p>
      {promotion ? <p className="relative mt-2 text-sm leading-relaxed text-muted">{t('promotion.inviteAccess')}</p> : null}
      <div className="relative mt-5 grid grid-cols-2 gap-2">
        <Link
          href={featured ? `/product/${featured.slug}` : '/catalog'}
          onClick={() => triggerHaptic('light')}
          className="btn-primary rounded-full py-3.5 text-center text-[14px] font-bold active:opacity-80"
        >
          {featured ? t('promotion.viewPlans', { price: formatCents(featured.minPriceCents) }) : t('home.hero.catalog')}
        </Link>
        <Link
          href={featured ? '/catalog' : '/orders'}
          onClick={() => triggerHaptic('light')}
          className="btn-ghost rounded-full py-3.5 text-center text-[14px] font-bold active:opacity-80"
        >
          {featured ? t('catalog.allServices') : t('home.hero.orders')}
        </Link>
      </div>
    </section>
  )
}
