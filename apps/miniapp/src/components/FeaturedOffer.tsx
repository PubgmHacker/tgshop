'use client'

import Link from 'next/link'
import { useI18n } from '@/i18n/I18nProvider'
import { formatCents } from '@/lib/format'
import { triggerHaptic } from '@/lib/TelegramProvider'
import type { ProductSummary } from '@/types/api'
import { BrandMark } from './BrandMark'
import { ProductBadges } from './ProductBadges'

export function FeaturedOffer({ product }: { product: ProductSummary }): JSX.Element | null {
  const { t, locale } = useI18n()
  if (!product.inStock || !product.promotion?.featured) return null
  return (
    <section className="glass glass-live flex flex-col gap-3 overflow-hidden rounded-[24px] p-4" aria-labelledby="featured-offer-title">
      <span className="glass-sheen" aria-hidden />
      <div className="flex items-center gap-3">
        <span className="mark-plate flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px]">
          <BrandMark slug={product.slug} size={30} />
        </span>
        <h2 id="featured-offer-title" className="text-xl font-bold tracking-[-0.02em] text-ink">{product.title}</h2>
      </div>
      <ProductBadges promotion={product.promotion} />
      <p className="text-sm leading-relaxed text-muted">{product.promotion.summary[locale]}</p>
      {product.promotion.limited ? <p className="text-xs text-muted">{t('promotion.inviteAccess')}</p> : null}
      <Link href={`/product/${encodeURIComponent(product.slug)}`} onClick={() => triggerHaptic('light')}
        className="btn-ghost min-h-11 rounded-full px-4 py-3 text-center text-sm font-semibold">
        {t('promotion.viewPlans', { price: formatCents(product.minPriceCents) })}
      </Link>
    </section>
  )
}
