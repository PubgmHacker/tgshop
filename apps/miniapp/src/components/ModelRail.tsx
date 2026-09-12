'use client'

import Link from 'next/link'
import { BrandMark } from './BrandMark'
import { triggerHaptic } from '@/lib/TelegramProvider'
import { useI18n } from '@/i18n/I18nProvider'
import type { ProductSummary } from '@/types/api'

export function ModelRail({
  products,
  isLoading = false
}: {
  products: ProductSummary[]
  isLoading?: boolean
}): JSX.Element | null {
  const { t } = useI18n()
  const tiles = products.filter((product) => product.inStock).map((product) => ({
    slug: product.slug,
    title: product.title,
    href: `/product/${encodeURIComponent(product.slug)}`
  }))

  if (!isLoading && tiles.length === 0) return null

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <h2 className="text-[16px] font-bold tracking-[-0.02em] text-ink">{t('home.models')}</h2>
      {isLoading ? (
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skeleton h-[112px] w-[100px] shrink-0 rounded-[22px]" />
          ))}
        </div>
      ) : tiles.length > 0 ? (
        <div className="min-w-0 overflow-x-auto overflow-y-hidden overscroll-x-contain no-scrollbar py-2">
          <div className="flex w-max gap-2.5">
            {tiles.map((item) => (
              <Link
                key={item.slug}
                href={item.href}
                onClick={() => triggerHaptic('light')}
                className="tile relative flex h-[112px] w-[100px] shrink-0 flex-col items-center justify-center gap-2 overflow-hidden rounded-[22px] px-2 active:scale-[0.98]"
              >
                <span className="mark-plate relative flex h-12 w-12 items-center justify-center rounded-[14px]">
                  <BrandMark slug={item.slug} size={30} />
                </span>
                <span className="max-w-full truncate text-[13px] font-bold tracking-[-0.02em] text-ink">
                  {item.title}
                </span>
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  )
}
