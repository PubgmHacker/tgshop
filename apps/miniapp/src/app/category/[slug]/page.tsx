'use client'

import { useParams } from 'next/navigation'
import { useI18n } from '@/i18n/I18nProvider'
import { errorMessageKey } from '@/lib/errors'
import { useBackButton } from '@/hooks/useBackButton'
import { useCategoryData } from '@/hooks/useApi'
import { ServiceTile } from '@/components/ServiceTile'
import { EmptyState, ErrorState } from '@/components/States'
import { formatCents } from '@/lib/format'

export default function CategoryPage(): JSX.Element {
  const params = useParams<{ slug: string }>()
  const slug = params.slug
  const { t } = useI18n()
  const { data, isLoading, isError, error, refetch } = useCategoryData(slug)

  useBackButton(true)

  return (
    <div className="page-enter flex flex-1 flex-col gap-4 px-4 pt-4">
      <header>
        {isLoading ? (
          <div className="skeleton h-6 w-40 rounded" />
        ) : (
          <h1 className="text-[22px] font-semibold tracking-[-0.04em] text-ink">
            {data?.category.title ?? t('category.notFound')}
          </h1>
        )}
      </header>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-2.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton h-[68px] rounded-[20px]" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState title={t(errorMessageKey(error))} onRetry={() => void refetch()} retryLabel={t('common.retry')} />
      ) : (data?.products.length ?? 0) === 0 ? (
        <EmptyState title={t('category.empty')} />
      ) : (
        <div className="grid grid-cols-1 gap-2.5">
          {data?.products.map((product) => (
            <ServiceTile
              key={product.id}
              href={`/product/${product.slug}`}
              slug={product.slug}
              title={product.title}
              meta={product.inStock ? `${t('catalog.from')} ${formatCents(product.minPriceCents)}` : t('catalog.badge.out')}
            />
          ))}
        </div>
      )}
    </div>
  )
}
