'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { useBackButton } from '@/hooks/useBackButton'
import { useMainButton } from '@/hooks/useMainButton'
import { useConfigData, useCreateOrder, useMeData, usePricingPreview, useProductData } from '@/hooks/useApi'
import { Icon, type IconName } from '@/components/Icons'
import { ErrorState } from '@/components/States'
import { discountedCents, formatCents, generateIdempotencyKey } from '@/lib/format'
import { openPaymentUrl } from '@/lib/payments'
import { errorMessageKey, mayHaveReachedServer } from '@/lib/errors'
import { triggerHaptic, triggerNotificationHaptic } from '@/lib/TelegramProvider'
import type { DictionaryKey } from '@/i18n/dictionaries'

type ProviderChoice = 'BALANCE' | 'CRYPTOBOT' | 'STARS' | 'TRON_TRC20'

const PROVIDERS: { value: ProviderChoice; labelKey: DictionaryKey; icon: IconName }[] = [
  { value: 'BALANCE', labelKey: 'checkout.method.balance', icon: 'wallet' },
  { value: 'CRYPTOBOT', labelKey: 'checkout.method.cryptobot', icon: 'card' },
  { value: 'STARS', labelKey: 'checkout.method.stars', icon: 'star' },
  { value: 'TRON_TRC20', labelKey: 'checkout.method.tron', icon: 'shield' }
]

/** The server accepts 1–99; anything else in the URL is a typo or a stale link. */
function readQty(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? '1', 10)
  if (!Number.isFinite(parsed)) return 1
  return Math.min(99, Math.max(1, parsed))
}

export default function NewCheckoutPage(): JSX.Element {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { t } = useI18n()
  const me = useMeData()
  const config = useConfigData()
  const [provider, setProvider] = useState<ProviderChoice>('BALANCE')
  const [error, setError] = useState<string | null>(null)
  const createOrderMutation = useCreateOrder()
  const preview = usePricingPreview()
  // One key per checkout attempt: a retry after a timeout reuses it so the
  // server dedups instead of creating a second order. It is rotated only once
  // the server has definitely answered (success or a 4xx/5xx it produced).
  const idempotencyKeyRef = useRef<string | null>(null)

  useBackButton(true)

  const planId = searchParams.get('planId') ?? ''
  const qty = readQty(searchParams.get('qty'))
  const promoCode = searchParams.get('promo') ?? undefined
  const productSlug = searchParams.get('product') ?? ''
  const product = useProductData(productSlug)
  const plan = useMemo(() => product.data?.plans.find((item) => item.id === planId) ?? null, [product.data, planId])

  // Balance and Stars are guaranteed by the bot's boot contract. Optional
  // rails only appear after /api/config confirms their credentials exist.
  const configuredProviders: ProviderChoice[] = config.data?.paymentMethods ?? []
  const availableProviders = PROVIDERS.filter((option) => configuredProviders.includes(option.value))
  const selectedProvider = configuredProviders.includes(provider)
    ? provider
    : (configuredProviders[0] ?? 'STARS')
  const isBlocked = me.data?.user.isBlocked === true

  // The summary is the same pricing the server will charge: plan × qty minus
  // the promo, computed by the same endpoint the order creation uses.
  const { mutate: previewPricing, reset: resetPreview } = preview
  useEffect(() => {
    if (!planId) return
    previewPricing({ planId, qty, promoCode })
    return () => resetPreview()
  }, [planId, qty, promoCode, previewPricing, resetPreview])

  const fallbackTotal = plan ? discountedCents(plan.priceCents, plan.discountPercent) * qty : null
  const totalCents = preview.data?.totalCents ?? fallbackTotal
  const quoteMatches = preview.data?.planId === planId && preview.data?.qty === qty &&
    (preview.data?.promoCode ?? '') === (promoCode ?? '').trim().toUpperCase()
  const balanceShort =
    selectedProvider === 'BALANCE' && me.data && totalCents !== null && me.data.balanceCents < totalCents

  async function handlePay(): Promise<void> {
    if (!canPay || createOrderMutation.isPending) return
    setError(null)
    idempotencyKeyRef.current ??= generateIdempotencyKey()
    try {
      const order = await createOrderMutation.mutateAsync({
        planId,
        qty,
        promoCode,
        provider: selectedProvider,
        idempotencyKey: idempotencyKeyRef.current
      })
      idempotencyKeyRef.current = null
      triggerNotificationHaptic('success')
      // CryptoBot / Stars hand back a payment URL — open it right away so the
      // user lands on the payment sheet, then poll the order page behind it.
      if (order.payUrl) {
        openPaymentUrl(order.payUrl)
      }
      router.replace(`/checkout/${order.orderId}`)
    } catch (err) {
      if (!mayHaveReachedServer(err)) idempotencyKeyRef.current = null
      setError(t(errorMessageKey(err)))
      triggerNotificationHaptic('error')
    }
  }

  const canPay = Boolean(plan?.inStock && me.data && config.data && quoteMatches) &&
    !preview.isPending && !preview.isError && !product.isError && !me.isError && !config.isError &&
    availableProviders.length > 0 && !isBlocked && !balanceShort

  useMainButton({
    text: totalCents !== null ? `${t('checkout.pay')} · ${formatCents(totalCents)}` : t('checkout.pay'),
    isLoading: createOrderMutation.isPending,
    isEnabled: canPay,
    onClick: () => void handlePay()
  })

  if (!planId || !productSlug || (product.data && !plan)) {
    return <ErrorState title={t('checkout.invalidParams')} onRetry={() => router.back()} retryLabel={t('common.back')} />
  }

  return (
    <div className="page-enter flex flex-1 flex-col gap-4 px-4 pt-3">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">{t('checkout.title')}</h1>
      </header>

      {product.isError || config.isError || me.isError || preview.isError ? (
        <ErrorState title={t(errorMessageKey(product.error ?? config.error ?? me.error ?? preview.error))}
          onRetry={() => { void product.refetch(); void config.refetch(); void me.refetch(); previewPricing({ planId, qty, promoCode }) }}
          retryLabel={t('common.retry')} />
      ) : null}
      {plan && !plan.inStock ? <p role="alert" className="text-danger">{t('product.outOfStock')}</p> : null}

      <section className="flex flex-col gap-2 rounded-card border border-line bg-card p-4" aria-live="polite">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-faint">{t('checkout.summary')}</p>
        {product.isLoading && !plan ? (
          <div className="skeleton h-5 w-2/3 rounded-md" />
        ) : (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">{product.data?.title ?? '—'}</p>
              <p className="truncate text-xs text-muted">{plan?.title ?? '—'}</p>
            </div>
            {plan ? <p className="tnum shrink-0 text-sm font-semibold text-ink">{formatCents(discountedCents(plan.priceCents, plan.discountPercent))}</p> : null}
          </div>
        )}
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted">{t('buySheet.qty')}</span>
          <span className="tnum font-semibold text-ink">×{qty}</span>
        </div>
        {preview.data?.promoCode ? (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted">
              {t('buySheet.promo')} · {preview.data.promoCode}
            </span>
            <span className="tnum font-semibold text-success">−{formatCents(preview.data.promoDiscountCents)}</span>
          </div>
        ) : null}
        <div className="flex items-center justify-between border-t border-line pt-2.5">
          <span className="text-sm font-semibold text-ink">{t('checkout.total')}</span>
          {totalCents !== null ? (
            <span className="tnum text-lg font-bold text-ink">{formatCents(totalCents)}</span>
          ) : (
            <span className="skeleton h-6 w-20 rounded-md" />
          )}
        </div>
      </section>

      <section className="flex flex-col gap-2.5">
        <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-faint">
          {t('checkout.method')}
        </p>
        <div className="grid grid-cols-2 gap-2.5">
          {availableProviders.map((option) => {
            const isActive = selectedProvider === option.value
            const isBalance = option.value === 'BALANCE'
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  triggerHaptic('light')
                  setError(null)
                  setProvider(option.value)
                }}
                aria-pressed={isActive}
                className={`flex flex-col items-center gap-2 rounded-tile border p-4 transition-colors ${
                  isActive ? 'border-line-strong bg-card-strong' : 'border-line bg-card'
                }`}
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-card-strong text-muted">
                  <Icon name={option.icon} size={17} />
                </span>
                <span className="text-xs font-semibold text-ink">{t(option.labelKey)}</span>
                {isBalance ? (
                  <span className="tnum text-[11px] text-faint">
                    {me.data ? formatCents(me.data.balanceCents) : ' '}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      </section>

      {isBlocked ? <p className="text-center text-sm text-danger">{t('common.error.blocked')}</p> : null}
      {balanceShort && !isBlocked ? (
        <p className="text-center text-sm text-danger">
          {t('checkout.insufficientBalance')}{' '}
          <button type="button" onClick={() => router.push('/topup')} className="font-semibold text-ink underline">
            {t('profile.topup')}
          </button>
        </p>
      ) : null}
      {error ? <p className="text-center text-sm text-danger">{error}</p> : null}

      <button
        type="button"
        onClick={() => void handlePay()}
        disabled={createOrderMutation.isPending || !canPay}
        className="rounded-full bg-cta py-3.5 text-center text-sm font-semibold text-cta-ink transition-opacity disabled:opacity-40"
      >
        {totalCents !== null ? `${t('checkout.pay')} · ${formatCents(totalCents)}` : t('checkout.pay')}
      </button>
    </div>
  )
}
