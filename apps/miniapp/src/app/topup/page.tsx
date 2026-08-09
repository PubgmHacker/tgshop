'use client'

import { useState } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { useBackButton } from '@/hooks/useBackButton'
import { useMainButton } from '@/hooks/useMainButton'
import { useCreateTopup } from '@/hooks/useApi'
import { QrCode } from '@/components/QrCode'
import { CopyButton } from '@/components/CopyButton'
import { formatCents, generateIdempotencyKey } from '@/lib/format'
import { triggerHaptic, triggerNotificationHaptic } from '@/lib/TelegramProvider'
import type { TopupMethod } from '@/types/api'

const PRESETS_CENTS = [500, 1000, 2500, 5000]

const METHODS: { value: TopupMethod; labelKey: 'checkout.method.cryptobot' | 'checkout.method.stars' | 'checkout.method.tron'; icon: string }[] = [
  { value: 'CRYPTOBOT', labelKey: 'checkout.method.cryptobot', icon: '🤖' },
  { value: 'STARS', labelKey: 'checkout.method.stars', icon: '⭐' },
  { value: 'TRON_TRC20', labelKey: 'checkout.method.tron', icon: '🪙' }
]

export default function TopupPage(): JSX.Element {
  const { t } = useI18n()
  const [amountCents, setAmountCents] = useState(1000)
  const [method, setMethod] = useState<TopupMethod>('CRYPTOBOT')
  const [error, setError] = useState<string | null>(null)
  const createTopupMutation = useCreateTopup()

  useBackButton(true)

  async function handleTopup(): Promise<void> {
    setError(null)
    try {
      const result = await createTopupMutation.mutateAsync({
        amountCents,
        method,
        idempotencyKey: generateIdempotencyKey()
      })
      triggerNotificationHaptic('success')
      if (result.redirectUrl) {
        window.location.href = result.redirectUrl
      }
    } catch {
      setError(t('common.error.generic'))
      triggerNotificationHaptic('error')
    }
  }

  useMainButton({
    text: t('topup.confirm'),
    isLoading: createTopupMutation.isPending,
    onClick: () => void handleTopup()
  })

  const tron = createTopupMutation.data?.tron

  return (
    <div className="page-enter flex flex-1 flex-col gap-4 pt-4">
      <header className="px-4">
        <h1 className="text-xl font-bold text-tg-text">{t('topup.title')}</h1>
      </header>

      <section className="flex flex-col gap-2 px-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-tg-section-header-text">
          {t('topup.presets')}
        </h2>
        <div className="grid grid-cols-4 gap-2">
          {PRESETS_CENTS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => {
                triggerHaptic('light')
                setAmountCents(preset)
              }}
              className={`rounded-full py-2 text-sm font-medium ${
                amountCents === preset ? 'bg-tg-button text-tg-button-text' : 'bg-tg-section-bg text-tg-text'
              }`}
            >
              {formatCents(preset)}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-1.5">
          <p className="text-sm text-tg-hint">{t('topup.amount')}</p>
          <input
            type="number"
            min={1}
            step={1}
            value={(amountCents / 100).toFixed(2)}
            onChange={(e) => {
              const dollars = Number.parseFloat(e.target.value)
              if (Number.isFinite(dollars) && dollars >= 0) {
                setAmountCents(Math.round(dollars * 100))
              }
            }}
            className="rounded-lg bg-tg-secondary-bg px-3 py-2 text-sm text-tg-text outline-none"
          />
        </div>
      </section>

      <section className="flex flex-col gap-2 px-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-tg-section-header-text">
          {t('topup.method')}
        </h2>
        <div className="flex flex-col gap-2">
          {METHODS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setMethod(option.value)}
              className={`flex items-center gap-3 rounded-card border px-4 py-3 text-left ${
                method === option.value ? 'border-tg-accent-text bg-tg-section-bg' : 'border-transparent bg-tg-section-bg'
              }`}
            >
              <span className="text-xl">{option.icon}</span>
              <span className="text-sm font-medium text-tg-text">{t(option.labelKey)}</span>
              {method === option.value ? <span className="ml-auto text-tg-accent-text">✓</span> : null}
            </button>
          ))}
        </div>
      </section>

      {tron ? (
        <section className="mx-4 flex flex-col items-center gap-3 rounded-card bg-tg-section-bg p-4">
          <QrCode value={`tron:${tron.address}?amount=${tron.amountUsdt6}`} />
          <div className="flex w-full items-center justify-between gap-2 rounded-lg bg-tg-secondary-bg px-3 py-2">
            <p className="truncate text-xs text-tg-text">{tron.address}</p>
            <CopyButton value={tron.address} label={t('checkout.tron.copyAddress')} />
          </div>
          <p className="text-sm font-semibold text-tg-text">{tron.amountUsdt6} USDT</p>
        </section>
      ) : null}

      {error ? <p className="px-4 text-sm text-tg-destructive">{error}</p> : null}

      <div className="px-4 pb-2">
        <button
          type="button"
          onClick={() => void handleTopup()}
          disabled={createTopupMutation.isPending}
          className="w-full rounded-full bg-tg-button py-3 text-center text-sm font-semibold text-tg-button-text disabled:opacity-50"
        >
          {t('topup.confirm')}
        </button>
      </div>
    </div>
  )
}
