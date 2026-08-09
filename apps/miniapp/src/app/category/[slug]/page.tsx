'use client'

import { useParams } from 'next/navigation'
import { useI18n } from '@/i18n/I18nProvider'
import { useBackButton } from '@/hooks/useBackButton'
import { useCategoryData } from '@/hooks/useApi'
import { ProductCard } from '@/components/ProductCard'
import { ProductCardSkeleton } from '@/components/Skeletons'
import { EmptyState, ErrorState } from '@/components/States'

export default function CategoryPage(): JSX.Element {
  const params = useParams<{ slug: string }>()
  const slug = params.slug
  const { t } = useI18n()
  const { data, isLoading, isError, refetch } = useCategoryData(slug)

  useBackButton(true)

  return (
    <div className="page-enter flex flex-1 flex-col gap-4 pt-4">
      <header className="px-4">
        {isLoading ? (
          <div className="skeleton h-6 w-40 rounded" />
        ) : (
          <h1 className="flex items-center gap-2 text-xl font-bold text-tg-text">
            {data?.category.emoji ? <span>{data.category.emoji}</span> : null}
            {data?.category.title ?? t('category.notFound')}
          </h1>
        )}
      </header>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 px-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <ProductCardSkeleton key={i} />
          ))}
        </div>
      ) : isError ? (
        <ErrorState title={t('common.error.network')} onRetry={() => void refetch()} retryLabel={t('common.retry')} />
      ) : (data?.products.length ?? 0) === 0 ? (
        <EmptyState title={t('category.empty')} />
      ) : (
        <div className="grid grid-cols-2 gap-3 px-4">
          {data?.products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  )
}
