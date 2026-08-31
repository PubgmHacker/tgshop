'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { useBackButton } from '@/hooks/useBackButton'
import { useMainButton } from '@/hooks/useMainButton'
import { useConfigData, useCreateOrder, useMeData } from '@/hooks/useApi'
import { Icon, type IconName } from '@/components/Icons'
import { formatCents, generateIdempotencyKey } from '@/lib/format'
import { openPaymentUrl } from '@/lib/payments'
import { ApiClientError } from '@/lib/apiClient'
import { triggerHaptic, triggerNotificationHaptic } from '@/lib/TelegramProvider'
import type { DictionaryKey } from '@/i18n/dictionaries'

type ProviderChoice = 'BALANCE' | 'CRYPTOBOT' | 'STARS' | 'TRON_TRC20'

const PROVIDERS: { value: ProviderChoice; labelKey: DictionaryKey; icon: IconName }[] = [
  { value: 'BALANCE', labelKey: 'checkout.method.balance', icon: 'wallet' },
  { value: 'CRYPTOBOT', labelKey: 'checkout.method.cryptobot', icon: 'card' },
  { value: 'STARS', labelKey: 'checkout.method.stars', icon: 'star' },
  { value: 'TRON_TRC20', labelKey: 'checkout.method.tron', icon: 'shield' }
]

export default function NewCheckoutPage(): JSX.Element {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { t } = useI18n()
  const me = useMeData()
  const config = useConfigData()
  const [provider, setProvider] = useState<ProviderChoice>('BALANCE')
  const [error, setError] = useState<string | null>(null)
  const createOrderMutation = useCreateOrder()

  useBackButton(true)

  const planId = searchParams.get('planId') ?? ''
  const qty = Number(searchParams.get('qty') ?? '1')
  const promoCode = searchParams.get('promo') ?? undefined
  // Balance and Stars are guaranteed by the bot's boot contract. Optional
  // rails only appear after /api/config confirms their credentials exist.
  const configuredProviders: ProviderChoice[] = config.data?.paymentMethods ?? ['BALANCE', 'STARS']
  const availableProviders = PROVIDERS.filter((option) => configuredProviders.includes(option.value))
  const selectedProvider = configuredProviders.includes(provider)
    ? provider
    : (configuredProviders[0] ?? 'STARS')

  async function handlePay(): Promise<void> {
    setError(null)
    try {
      const order = await createOrderMutation.mutateAsync({
        planId,
        qty,
        promoCode,
        provider: selectedProvider,
        idempotencyKey: generateIdempotencyKey()
      })
      triggerNotificationHaptic('success')
      // CryptoBot / Stars hand back a payment URL — open it right away so the
      // user lands on the payment sheet, then poll the order page behind it.
      if (order.payUrl) {
        openPaymentUrl(order.payUrl)
      }
      router.replace(`/checkout/${order.orderId}`)
    } catch (err) {
      setError(
        err instanceof ApiClientError && err.code === 'INSUFFICIENT_BALANCE'
          ? t('checkout.insufficientBalance')
          : err instanceof ApiClientError && err.code === 'PAYMENT_METHOD_UNAVAILABLE'
            ? t('checkout.methodUnavailable')
            : t('common.error.generic')
      )
      triggerNotificationHaptic('error')
    }
  }

  useMainButton({
    text: t('checkout.pay'),
    isLoading: createOrderMutation.isPending,
    isEnabled: Boolean(planId && availableProviders.length > 0),
    onClick: () => void handlePay()
  })

  return (
    <div className="page-enter flex flex-1 flex-col gap-4 px-4 pt-3">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">{t('checkout.title')}</h1>
      </header>

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
                    {me.data ? formatCents(me.data.balanceCents) : '\u00A0'}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      </section>

      {error ? <p className="text-center text-sm text-danger">{error}</p> : null}

      <button
        type="button"
        onClick={() => void handlePay()}
        disabled={createOrderMutation.isPending || !planId || availableProviders.length === 0}
        className="rounded-full bg-cta py-3.5 text-center text-sm font-semibold text-cta-ink transition-opacity disabled:opacity-40"
      >
        {t('checkout.pay')}
      </button>
    </div>
  )
}
