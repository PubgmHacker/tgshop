'use client'

import { useMemo } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { errorMessageKey } from '@/lib/errors'
import { useBackButton } from '@/hooks/useBackButton'
import { useHomeData, useMeData } from '@/hooks/useApi'
import { CollectionGrid } from '@/components/CollectionGrid'
import { HomeHero } from '@/components/HomeHero'
import { ModelRail } from '@/components/ModelRail'
import { ErrorState } from '@/components/States'

export default function HomePage(): JSX.Element {
  const { t } = useI18n()
  const me = useMeData()
  const home = useHomeData()

  useBackButton(false)

  const categories = home.data?.categories ?? []
  const counts = useMemo(() => {
    const next: Record<string, number> = {}
    for (const product of home.data?.bestsellers ?? []) {
      next[product.categorySlug] = (next[product.categorySlug] ?? 0) + 1
    }
    return next
  }, [home.data?.bestsellers])

  return (
    <div className="page-enter flex min-w-0 flex-1 flex-col gap-5 overflow-x-hidden px-4 pt-2">
      {me.isError ? (
        <ErrorState
          title={t(errorMessageKey(me.error ?? home.error))}
          onRetry={() => void me.refetch()}
          retryLabel={t('common.retry')}
        />
      ) : (
        <HomeHero balanceCents={me.data?.balanceCents ?? null} isLoading={me.isLoading} />
      )}

      {home.isError ? (
        <ErrorState
          title={t('common.error.generic')}
          onRetry={() => void home.refetch()}
          retryLabel={t('common.retry')}
        />
      ) : (
        <>
          <ModelRail products={home.data?.bestsellers ?? []} isLoading={home.isLoading} />

          <CollectionGrid categories={categories} counts={counts} isLoading={home.isLoading} />
        </>
      )}
    </div>
  )
}
