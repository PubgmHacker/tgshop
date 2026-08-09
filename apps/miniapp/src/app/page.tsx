'use client'

import { useI18n } from '@/i18n/I18nProvider'
import { useBackButton } from '@/hooks/useBackButton'
import { useHomeData } from '@/hooks/useApi'
import { CategoryChipRow } from '@/components/CategoryChip'
import { ProductCard } from '@/components/ProductCard'
import { CategoryChipSkeleton, ProductCardSkeleton } from '@/components/Skeletons'
import { EmptyState, ErrorState } from '@/components/States'
import { BRAND_NAME } from '@/lib/tokens'

export default function HomePage(): JSX.Element {
  const { t } = useI18n()
  const { data, isLoading, isError, refetch } = useHomeData()

  useBackButton(false)

  return (
    <div className="page-enter flex flex-1 flex-col gap-5 pt-4">
      <header className="px-4">
        <h1 className="text-xl font-bold text-tg-text">{BRAND_NAME}</h1>
      </header>

      {data?.banners && data.banners.length > 0 ? (
        <div className="no-scrollbar flex gap-3 overflow-x-auto px-4">
          {data.banners.map((banner) => (
            <div
              key={banner.id}
              className="relative aspect-[16/7] w-[85%] shrink-0 overflow-hidden rounded-card bg-brand-gradient"
            >
              {banner.title ? (
                <p className="absolute bottom-3 left-3 text-sm font-semibold text-white drop-shadow">
                  {banner.title}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="px-4 text-sm font-semibold uppercase tracking-wide text-tg-section-header-text">
          {t('home.categories')}
        </h2>
        {isLoading ? (
          <div className="flex gap-2 px-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <CategoryChipSkeleton key={i} />
            ))}
          </div>
        ) : isError ? null : (
          <CategoryChipRow categories={data?.categories ?? []} />
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="px-4 text-sm font-semibold uppercase tracking-wide text-tg-section-header-text">
          {t('home.bestsellers')}
        </h2>

        {isLoading ? (
          <div className="grid grid-cols-2 gap-3 px-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <ProductCardSkeleton key={i} />
            ))}
          </div>
        ) : isError ? (
          <ErrorState title={t('common.error.network')} onRetry={() => void refetch()} retryLabel={t('common.retry')} />
        ) : (data?.bestsellers.length ?? 0) === 0 ? (
          <EmptyState title={t('home.empty.bestsellers')} />
        ) : (
          <div className="grid grid-cols-2 gap-3 px-4">
            {data?.bestsellers.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
