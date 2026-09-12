'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useI18n } from '@/i18n/I18nProvider'
import { errorMessageKey } from '@/lib/errors'
import { useBackButton } from '@/hooks/useBackButton'
import { useCatalogData } from '@/hooks/useApi'
import { Icon } from '@/components/Icons'
import { ServiceTile } from '@/components/ServiceTile'
import { ErrorState } from '@/components/States'
import type { ProductPromotion } from '@/types/api'

export default function CatalogPage(): JSX.Element {
  const { t } = useI18n()
  const searchParams = useSearchParams()
  const { data, isLoading, isError, error, refetch } = useCatalogData()
  const [query, setQuery] = useState(searchParams.get('q') ?? '')
  const initialCat = searchParams.get('cat') ?? 'all'

  useBackButton(false)

  const tiles = useMemo(() => {
    if (!data) return []
    const q = query.trim().toLowerCase()
    const rows: {
      id: string
      href: string
      slug: string
      title: string
      meta: string
      promotion?: ProductPromotion | null
    }[] = []

    for (const category of data.categories) {
      if (initialCat !== 'all' && category.slug !== initialCat) continue
      for (const product of category.products) {
        if (q && !product.title.toLowerCase().includes(q)) continue
        rows.push({
          id: product.id,
          href: `/product/${product.slug}`,
          slug: product.slug,
          title: product.title,
          promotion: product.promotion,
          meta: product.plans.some((plan) => plan.inStock)
            ? t('product.inStock')
            : t('catalog.badge.out')
        })
      }
    }

    return rows.sort((a, b) => Number(Boolean(b.promotion?.featured)) - Number(Boolean(a.promotion?.featured)))
  }, [data, query, initialCat, t])

  return (
    <div className="page-enter flex flex-1 flex-col gap-4 px-4 pt-3">
      <header className="flex items-end justify-between gap-3">
        <h1 className="text-[24px] font-bold tracking-[-0.03em] text-ink">{t('catalog.pick')}</h1>
      </header>

      {initialCat !== 'all' ? <Link href="/catalog" className="text-sm underline">{t('catalog.allServices')}</Link> : null}
      <div className="tile flex items-center gap-2.5 rounded-full px-4 py-3">
        <Icon name="search" size={17} className="shrink-0 text-faint" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t('catalog.search')}
          placeholder={t('catalog.search')}
          className="min-w-0 w-full bg-transparent text-base font-medium text-ink placeholder:text-muted"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label={t('common.clear')}
            className="flex h-11 w-11 shrink-0 items-center justify-center text-faint"
          >
            <Icon name="close" size={15} />
          </button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-2.5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton h-[68px] rounded-[20px]" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState
          title={t(errorMessageKey(error))}
          onRetry={() => void refetch()}
          retryLabel={t('common.retry')}
        />
      ) : tiles.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-card border border-line bg-card px-5 py-10 text-center">
          <p className="text-sm font-medium text-ink">{t('catalog.empty')}</p>
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="rounded-full bg-cta px-4 py-2.5 text-sm font-semibold text-cta-ink"
            >
              {t('common.clear')}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 pb-4">
          {tiles.map((tile) => (
            <ServiceTile
              key={tile.id}
              href={tile.href}
              slug={tile.slug}
              title={tile.title}
              meta={tile.meta}
              promotion={tile.promotion}
            />
          ))}
        </div>
      )}
    </div>
  )
}
