'use client'

import { useMemo, useState } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { useConfigData, useCreateTopup } from '@/hooks/useApi'
import { formatCents, generateIdempotencyKey } from '@/lib/format'
import { openPaymentUrl } from '@/lib/payments'
import { triggerHaptic, triggerNotificationHaptic } from '@/lib/TelegramProvider'
import { ApiClientError } from '@/lib/apiClient'
import type { TopupMethod } from '@/types/api'
import { CopyButton } from './CopyButton'
import { QrCode } from './QrCode'
import { SectionLabel } from './SectionLabel'

// The server decides which of these are offered (config.topupMethods). TRON
// needs no order: the invoice is identified by its unique tagged amount, so a
// top-up works exactly like an order payment (apps/bot/src/payments/tron.ts).
const TOPUP_METHODS: { value: TopupMethod; title: string; badge: string; badgeClass: string }[] = [
  { value: 'CRYPTOBOT', title: 'CryptoBot USDT', badge: 'T', badgeClass: 'bg-[#26a17b] text-white' },
  { value: 'STARS', title: 'Telegram Stars', badge: '★', badgeClass: 'bg-card-strong text-warning' },
  { value: 'TRON_TRC20', title: 'USDT TRC-20', badge: '₮', badgeClass: 'bg-[#c23631] text-white' }
]

export function TopupPanel(): JSX.Element {
  const { t } = useI18n()
  const config = useConfigData()
  const [method, setMethod] = useState<TopupMethod>('STARS')
  const [amountInput, setAmountInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const createTopup = useCreateTopup()

  const availableMethodValues: TopupMethod[] = config.data?.topupMethods ?? ['STARS']
  const availableMethods = TOPUP_METHODS.filter((option) => availableMethodValues.includes(option.value))
  const selectedMethod = availableMethodValues.includes(method) ? method : (availableMethodValues[0] ?? 'STARS')
  const minTopupCents = config.data?.minTopupCents ?? 500

  const amountCents = useMemo(() => {
    const parsed = Number.parseFloat(amountInput.replace(',', '.'))
    if (!Number.isFinite(parsed) || parsed <= 0) return 0
    return Math.round(parsed * 100)
  }, [amountInput])

  async function handleCreate(): Promise<void> {
    if (amountCents < minTopupCents || createTopup.isPending || !selectedMethod) return
    setError(null)
    try {
      const result = await createTopup.mutateAsync({
        amountCents,
        method: selectedMethod,
        idempotencyKey: generateIdempotencyKey()
      })
      triggerNotificationHaptic('success')
      if (result.redirectUrl) {
        openPaymentUrl(result.redirectUrl)
      }
    } catch (err) {
      setError(err instanceof ApiClientError && err.code === 'PAYMENT_METHOD_UNAVAILABLE' ? t('checkout.methodUnavailable') : t('common.error.generic'))
      triggerNotificationHaptic('error')
    }
  }

  return (
    <section id="topup" className="flex flex-col gap-2.5">
      <SectionLabel>{t('profile.topupSection')}</SectionLabel>

      <div className="grid grid-cols-2 gap-2.5">
        {availableMethods.map((option) => {
          const isActive = selectedMethod === option.value
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                triggerHaptic('light')
                setMethod(option.value)
              }}
              className={`flex flex-col items-center gap-2 rounded-tile border p-4 transition-colors ${
                isActive ? 'border-line-strong bg-card-strong' : 'border-line bg-card'
              }`}
            >
              <span className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${option.badgeClass}`}>
                {option.badge}
              </span>
              <span className="text-xs font-semibold text-ink">{option.title}</span>
            </button>
          )
        })}
      </div>

      <label className="flex items-center gap-2 rounded-card border border-line bg-card px-4 py-3">
        <input
          inputMode="decimal"
          placeholder={(minTopupCents / 100).toFixed(2)}
          aria-label={t('topup.amount')}
          min={minTopupCents / 100}
          value={amountInput}
          onChange={(e) => setAmountInput(e.target.value)}
          className="tnum w-full bg-transparent text-sm text-ink outline-none placeholder:text-faint"
        />
        <span className="text-xs font-semibold text-faint">USD</span>
      </label>

      <div className="flex flex-col gap-2 rounded-card border border-line bg-card p-4">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted">{t('topup.fee')}</span>
          <span className="tnum font-semibold text-ink">$0.00</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted">{t('topup.totalDue')}</span>
          <span className="tnum font-semibold text-ink">{formatCents(amountCents)}</span>
        </div>
      </div>

      <button
        type="button"
        onClick={() => void handleCreate()}
        disabled={amountCents < minTopupCents || createTopup.isPending || availableMethods.length === 0}
        className="rounded-full bg-cta py-3.5 text-center text-sm font-semibold text-cta-ink transition-opacity disabled:opacity-40"
      >
        {t('topup.confirm')}
      </button>

      {createTopup.data?.tron ? (
        <div className="flex flex-col items-center gap-3 rounded-card border border-line bg-card p-4">
          <p className="text-sm font-semibold text-ink">{t('checkout.tron.network')}</p>
          <QrCode value={createTopup.data.tron.address} />
          <div className="flex w-full items-center justify-between gap-2 rounded-xl bg-card-strong px-3 py-2.5">
            <p className="truncate text-xs text-ink">{createTopup.data.tron.address}</p>
            <CopyButton value={createTopup.data.tron.address} label={t('checkout.tron.copyAddress')} />
          </div>
          <div className="flex w-full items-center justify-between gap-2 rounded-xl bg-card-strong px-3 py-2.5">
            <div className="flex min-w-0 flex-col">
              <p className="text-xs text-muted">{t('checkout.tron.amount')}</p>
              <p className="tnum text-base font-semibold text-ink">{createTopup.data.tron.amountDisplay} USDT</p>
            </div>
            <CopyButton value={createTopup.data.tron.amountDisplay} label={t('checkout.tron.copyAmount')} />
          </div>
          <p className="text-center text-xs leading-relaxed text-danger">{t('checkout.tron.exact')}</p>
          <p className="animate-pulse text-xs text-faint">{t('checkout.tron.waiting')}</p>
        </div>
      ) : null}

      {availableMethods.length === 0 ? <p className="text-center text-xs text-muted">{t('topup.noMethods')}</p> : null}
      {amountCents > 0 && amountCents < minTopupCents ? (
        <p className="text-center text-xs text-muted">
          {t('topup.minAmount', { amount: formatCents(minTopupCents) })}
        </p>
      ) : null}
      {error ? <p className="text-center text-xs text-danger">{error}</p> : null}
      <p className="px-2 text-center text-[11px] leading-relaxed text-faint">{t('topup.hint')}</p>
    </section>
  )
}
