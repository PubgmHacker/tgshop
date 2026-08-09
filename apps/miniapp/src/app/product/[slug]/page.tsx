'use client'

import Image from 'next/image'
import { useParams, useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { useBackButton } from '@/hooks/useBackButton'
import { useMainButton } from '@/hooks/useMainButton'
import { useProductData } from '@/hooks/useApi'
import { ErrorState } from '@/components/States'
import { formatCents } from '@/lib/format'
import type { Plan } from '@/types/api'
import { BuySheet } from './BuySheet'

export default function ProductPage(): JSX.Element {
  const params = useParams<{ slug: string }>()
  const slug = params.slug
  const router = useRouter()
  const { t } = useI18n()
  const { data, isLoading, isError, refetch } = useProductData(slug)
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [isSheetOpen, setIsSheetOpen] = useState(false)

  useBackButton(true)

  const selectedPlan = useMemo<Plan | null>(() => {
    if (!data) return null
    return data.plans.find((plan) => plan.id === selectedPlanId) ?? data.plans[0] ?? null
  }, [data, selectedPlanId])

  useMainButton({
    text: t('product.buyNow'),
    isVisible: Boolean(data) && !isError,
    isEnabled: Boolean(selectedPlan?.inStock),
    onClick: () => setIsSheetOpen(true)
  })

  if (isLoading) {
    return (
      <div className="page-enter flex flex-1 flex-col gap-4 pt-4">
        <div className="skeleton mx-4 aspect-square rounded-card" />
        <div className="mx-4 skeleton h-6 w-3/4 rounded" />
        <div className="mx-4 skeleton h-4 w-1/2 rounded" />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <ErrorState
        title={t('product.notFound')}
        onRetry={() => void refetch()}
        retryLabel={t('common.retry')}
      />
    )
  }

  return (
    <div className="page-enter flex flex-1 flex-col gap-4 pb-6 pt-4">
      <div className="relative mx-4 aspect-square overflow-hidden rounded-card bg-tg-secondary-bg">
        {data.imageUrl ? (
          <Image src={data.imageUrl} alt={data.title} fill sizes="480px" className="object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-5xl">🛍️</div>
        )}
      </div>

      <div className="flex flex-col gap-1 px-4">
        <p className="text-xs font-medium text-tg-hint">{data.categoryTitle}</p>
        <h1 className="text-xl font-bold text-tg-text">{data.title}</h1>
      </div>

      <section className="flex flex-col gap-2 px-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-tg-section-header-text">
          {t('product.plans')}
        </h2>
        <div className="flex flex-col gap-2">
          {data.plans.map((plan) => (
            <PlanRow
              key={plan.id}
              plan={plan}
              isSelected={plan.id === selectedPlan?.id}
              onSelect={() => setSelectedPlanId(plan.id)}
            />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2 px-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-tg-section-header-text">
          {t('product.description')}
        </h2>
        <p className="whitespace-pre-line text-sm text-tg-text/90">{data.description}</p>
      </section>

      <div className="px-4 pb-2">
        <button
          type="button"
          disabled={!selectedPlan?.inStock}
          onClick={() => setIsSheetOpen(true)}
          className="w-full rounded-full bg-tg-button py-3 text-center text-sm font-semibold text-tg-button-text disabled:opacity-40"
        >
          {t('product.buyNow')}
        </button>
      </div>

      {selectedPlan ? (
        <BuySheet
          isOpen={isSheetOpen}
          onClose={() => setIsSheetOpen(false)}
          plan={selectedPlan}
          onProceedToCheckout={({ planId, qty, promoCode }) => {
            setIsSheetOpen(false)
            const search = new URLSearchParams({ planId, qty: String(qty) })
            if (promoCode) search.set('promo', promoCode)
            router.push(`/checkout/new?${search.toString()}`)
          }}
        />
      ) : null}
    </div>
  )
}

function PlanRow({
  plan,
  isSelected,
  onSelect
}: {
  plan: Plan
  isSelected: boolean
  onSelect: () => void
}): JSX.Element {
  const { t } = useI18n()

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!plan.inStock}
      className={`flex items-center justify-between rounded-card border px-4 py-3 text-left transition-colors disabled:opacity-40 ${
        isSelected ? 'border-tg-accent-text bg-tg-section-bg' : 'border-transparent bg-tg-section-bg'
      }`}
    >
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-medium text-tg-text">{plan.title}</p>
        <p className="text-xs text-tg-hint">
          {plan.durationDays ? t('product.duration.days', { days: plan.durationDays }) : t('product.duration.lifetime')}
        </p>
        {!plan.inStock ? (
          <p className="text-xs text-tg-destructive">{t('product.outOfStock')}</p>
        ) : plan.lowStock ? (
          <p className="text-xs text-tg-destructive">{t('product.lowStock')}</p>
        ) : (
          <p className="text-xs text-tg-hint">{t('product.inStock')}</p>
        )}
      </div>
      <div className="flex flex-col items-end gap-0.5">
        <p className="text-sm font-semibold text-tg-text">{formatCents(plan.priceCents)}</p>
        {plan.discountPercent > 0 ? (
          <p className="text-xs text-tg-accent-text">{t('product.discount', { percent: plan.discountPercent })}</p>
        ) : null}
      </div>
    </button>
  )
}
