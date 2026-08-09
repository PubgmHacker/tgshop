'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useI18n } from '@/i18n/I18nProvider'
import { formatCents } from '@/lib/format'
import { triggerHaptic } from '@/lib/TelegramProvider'
import type { ProductSummary } from '@/types/api'

export function ProductCard({ product }: { product: ProductSummary }): JSX.Element {
  const { t } = useI18n()

  return (
    <Link
      href={`/product/${product.slug}`}
      onClick={() => triggerHaptic('light')}
      className="flex flex-col overflow-hidden rounded-card bg-tg-section-bg shadow-card active:opacity-90"
    >
      <div className="relative aspect-square w-full bg-tg-secondary-bg">
        {product.imageUrl ? (
          <Image
            src={product.imageUrl}
            alt={product.title}
            fill
            sizes="200px"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-3xl">🛍️</div>
        )}
        {product.maxDiscountPercent > 0 ? (
          <span className="absolute left-2 top-2 rounded-full bg-brand-gradient px-2 py-0.5 text-[11px] font-semibold text-white">
            -{product.maxDiscountPercent}%
          </span>
        ) : null}
        {!product.inStock ? (
          <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-xs font-medium text-white">
            {t('product.outOfStock')}
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-1 p-2.5">
        <p className="line-clamp-2 text-sm font-medium text-tg-text">{product.title}</p>
        <p className="text-sm font-semibold text-tg-accent-text">{formatCents(product.minPriceCents)}</p>
      </div>
    </Link>
  )
}
