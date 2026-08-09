'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { useBackButton } from '@/hooks/useBackButton'
import { useMainButton } from '@/hooks/useMainButton'
import { useCreateOrder } from '@/hooks/useApi'
import { generateIdempotencyKey } from '@/lib/format'
import { triggerNotificationHaptic } from '@/lib/TelegramProvider'

type ProviderChoice = 'BALANCE' | 'CRYPTOBOT' | 'STARS' | 'TRON_TRC20'

const PROVIDERS: { value: ProviderChoice; labelKey: 'checkout.method.balance' | 'checkout.method.cryptobot' | 'checkout.method.stars' | 'checkout.method.tron'; icon: string }[] = [
  { value: 'BALANCE', labelKey: 'checkout.method.balance', icon: '💰' },
  { value: 'CRYPTOBOT', labelKey: 'checkout.method.cryptobot', icon: '🤖' },
  { value: 'STARS', labelKey: 'checkout.method.stars', icon: '⭐' },
  { value: 'TRON_TRC20', labelKey: 'checkout.method.tron', icon: '🪙' }
]

export default function NewCheckoutPage(): JSX.Element {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { t } = useI18n()
  const [provider, setProvider] = useState<ProviderChoice>('BALANCE')
  const [error, setError] = useState<string | null>(null)
  const createOrderMutation = useCreateOrder()

  useBackButton(true)

  const planId = searchParams.get('planId') ?? ''
  const qty = Number(searchParams.get('qty') ?? '1')
  const promoCode = searchParams.get('promo') ?? undefined

  async function handlePay(): Promise<void> {
    setError(null)
    try {
      const order = await createOrderMutation.mutateAsync({
        planId,
        qty,
        promoCode,
        provider,
        idempotencyKey: generateIdempotencyKey()
      })
      triggerNotificationHaptic('success')
      router.replace(`/checkout/${order.orderId}`)
    } catch {
      setError(t('common.error.generic'))
      triggerNotificationHaptic('error')
    }
  }

  useMainButton({
    text: t('checkout.pay'),
    isLoading: createOrderMutation.isPending,
    isEnabled: Boolean(planId),
    onClick: () => void handlePay()
  })

  return (
    <div className="page-enter flex flex-1 flex-col gap-4 pt-4">
      <header className="px-4">
        <h1 className="text-xl font-bold text-tg-text">{t('checkout.title')}</h1>
      </header>

      <section className="flex flex-col gap-2 px-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-tg-section-header-text">
          {t('checkout.method')}
        </h2>
        <div className="flex flex-col gap-2">
          {PROVIDERS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setProvider(option.value)}
              className={`flex items-center gap-3 rounded-card border px-4 py-3 text-left ${
                provider === option.value ? 'border-tg-accent-text bg-tg-section-bg' : 'border-transparent bg-tg-section-bg'
              }`}
            >
              <span className="text-xl">{option.icon}</span>
              <span className="text-sm font-medium text-tg-text">{t(option.labelKey)}</span>
              {provider === option.value ? (
                <span className="ml-auto text-tg-accent-text">✓</span>
              ) : null}
            </button>
          ))}
        </div>
      </section>

      {error ? <p className="px-4 text-sm text-tg-destructive">{error}</p> : null}

      <div className="px-4 pb-2">
        <button
          type="button"
          onClick={() => void handlePay()}
          disabled={createOrderMutation.isPending || !planId}
          className="w-full rounded-full bg-tg-button py-3 text-center text-sm font-semibold text-tg-button-text disabled:opacity-50"
        >
          {t('checkout.pay')}
        </button>
      </div>
    </div>
  )
}
