'use client'

import { useParams, useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { useBackButton } from '@/hooks/useBackButton'
import { useMainButton } from '@/hooks/useMainButton'
import { useProductData } from '@/hooks/useApi'
import { Icon } from '@/components/Icons'
import { ErrorState } from '@/components/States'
import { BrandMark } from '@/components/BrandMark'
import { formatCents } from '@/lib/format'
import { triggerHaptic } from '@/lib/TelegramProvider'
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
      <div className="page-enter flex flex-1 flex-col gap-4 px-4 pt-3">
        <div className="skeleton h-20 rounded-tile" />
        <div className="skeleton h-16 rounded-card" />
        <div className="skeleton h-16 rounded-card" />
        <div className="skeleton h-28 rounded-card" />
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
    <div className="page-enter flex flex-1 flex-col gap-4 px-4 pb-4 pt-3">
      <header className="glass glass-live flex items-center gap-3.5 overflow-hidden rounded-[24px] px-4 py-4 [--sheen-radius:24px]">
        <span className="glass-sheen" aria-hidden />
        <span className="mark-plate relative flex h-16 w-16 shrink-0 items-center justify-center rounded-[18px]">
          <BrandMark slug={data.slug} size={42} />
        </span>
        <span className="relative min-w-0">
          <p className="text-[13px] font-semibold text-muted">{data.categoryTitle}</p>
          <h1 className="text-[24px] font-bold leading-tight tracking-[-0.03em] text-ink">{data.title}</h1>
        </span>
      </header>

      <section className="flex flex-col gap-2.5">
        <p className="text-[13px] font-medium text-muted">{t('product.plans')}</p>
        <div className="flex flex-col gap-2">
          {data.plans.map((plan) => (
            <PlanRow
              key={plan.id}
              plan={plan}
              isSelected={plan.id === selectedPlan?.id}
              onSelect={() => {
                triggerHaptic('light')
                setSelectedPlanId(plan.id)
              }}
            />
          ))}
        </div>
      </section>

      {data.description ? (
        <section className="flex flex-col gap-2.5">
          <p className="text-[13px] font-medium text-muted">{t('product.description')}</p>
          <div className="tile rounded-card p-4">
            <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink">{data.description}</p>
          </div>
        </section>
      ) : null}

      <button
        type="button"
        disabled={!selectedPlan?.inStock}
        onClick={() => setIsSheetOpen(true)}
        className="flex items-center justify-center gap-2 rounded-full bg-cta py-3.5 text-center text-sm font-semibold text-cta-ink transition-opacity disabled:opacity-40"
      >
        <Icon name="bag" size={16} />
        {t('product.buyNow')}
      </button>

      {selectedPlan ? (
        <BuySheet
          isOpen={isSheetOpen}
          onClose={() => setIsSheetOpen(false)}
          plan={selectedPlan}
          onProceedToCheckout={({ planId, qty, promoCode }) => {
            setIsSheetOpen(false)
            const search = new URLSearchParams({ planId, qty: String(qty), product: data.slug })
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
      className={`tile flex items-center justify-between rounded-card px-4 py-3.5 text-left transition-colors disabled:cursor-not-allowed ${
        isSelected ? 'ring-1 ring-line-strong' : ''
      }`}
    >
      <div className="flex flex-col gap-0.5">
        <p className={`text-[15px] font-bold ${plan.inStock ? 'text-ink' : 'text-muted'}`}>{plan.title}</p>
        <p className="text-[13px] font-medium text-muted">
          {plan.durationDays ? t('product.duration.days', { days: plan.durationDays }) : t('product.duration.lifetime')}
        </p>
        {!plan.inStock ? (
          <p className="text-xs font-medium text-danger">{t('product.outOfStock')}</p>
        ) : plan.lowStock ? (
          <p className="text-xs font-medium text-warning">{t('product.lowStock')}</p>
        ) : (
          <p className="text-xs text-success">{t('product.inStock')}</p>
        )}
      </div>
      <div className="flex flex-col items-end gap-0.5">
        <p className="tnum text-[17px] font-bold text-ink">{formatCents(plan.priceCents)}</p>
        {plan.discountPercent > 0 ? (
          <p className="text-xs font-medium text-success">{t('product.discount', { percent: plan.discountPercent })}</p>
        ) : null}
      </div>
    </button>
  )
}
