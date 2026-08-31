'use client'

import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useI18n } from '@/i18n/I18nProvider'
import { useBackButton } from '@/hooks/useBackButton'
import { useCatalogData } from '@/hooks/useApi'
import { Icon } from '@/components/Icons'
import { ServiceTile } from '@/components/ServiceTile'
import { ErrorState } from '@/components/States'

export default function CatalogPage(): JSX.Element {
  const { t } = useI18n()
  const searchParams = useSearchParams()
  const { data, isLoading, isError, refetch } = useCatalogData()
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
    }[] = []

    const allCount = data.categories.reduce((sum, category) => sum + category.products.length, 0)
    if (!q && initialCat === 'all') {
      rows.push({
        id: 'all',
        href: '/catalog',
        slug: 'all',
        title: t('catalog.allServices'),
        meta: t('catalog.positions', { count: allCount })
      })
    }

    for (const category of data.categories) {
      if (initialCat !== 'all' && category.slug !== initialCat) continue
      for (const product of category.products) {
        if (q && !product.title.toLowerCase().includes(q)) continue
        rows.push({
          id: product.id,
          href: `/product/${product.slug}`,
          slug: product.slug,
          title: product.title,
          meta: t('catalog.positions', { count: product.plans.length })
        })
      }
    }

    return rows
  }, [data, query, initialCat, t])

  return (
    <div className="page-enter flex flex-1 flex-col gap-4 px-4 pt-3">
      <header className="flex items-end justify-between gap-3">
        <h1 className="text-[24px] font-bold tracking-[-0.03em] text-ink">{t('catalog.pick')}</h1>
      </header>

      <label className="tile flex items-center gap-2.5 rounded-full px-4 py-3">
        <Icon name="search" size={17} className="shrink-0 text-faint" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t('catalog.search')}
          placeholder={t('catalog.search')}
          className="w-full bg-transparent text-[15px] font-medium text-ink outline-none placeholder:text-muted"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label={t('common.close')}
            className="text-faint"
          >
            <Icon name="close" size={15} />
          </button>
        ) : null}
      </label>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-2.5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton h-[68px] rounded-[20px]" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState
          title={t('common.error.network')}
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
        <div className="grid grid-cols-2 gap-2.5 pb-4">
          {tiles.map((tile) => (
            <ServiceTile
              key={tile.id}
              href={tile.href}
              slug={tile.slug}
              title={tile.title}
              meta={tile.meta}
            />
          ))}
        </div>
      )}
    </div>
  )
}
