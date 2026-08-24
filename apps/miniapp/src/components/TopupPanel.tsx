'use client'

import { useMemo, useState } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { useCreateTopup } from '@/hooks/useApi'
import { formatCents, generateIdempotencyKey } from '@/lib/format'
import { openPaymentUrl } from '@/lib/payments'
import { triggerHaptic, triggerNotificationHaptic } from '@/lib/TelegramProvider'
import type { TopupMethod } from '@/types/api'
import { QrCode } from './QrCode'
import { SectionLabel } from './SectionLabel'

// TRON_TRC20 is deliberately absent: top-ups have no order to bind a deposit
// address to (see apps/bot/src/server/routes/api/topup.ts), so offering it
// here would only produce an error after the tap.
const TOPUP_METHODS: { value: TopupMethod; title: string; badge: string }[] = [
  { value: 'CRYPTOBOT', title: 'CryptoBot USDT', badge: 'T' },
  { value: 'STARS', title: 'Telegram Stars', badge: '★' }
]

const MIN_TOPUP_CENTS = 100

export function TopupPanel(): JSX.Element {
  const { t } = useI18n()
  const [method, setMethod] = useState<TopupMethod>('CRYPTOBOT')
  const [amountInput, setAmountInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const createTopup = useCreateTopup()

  const amountCents = useMemo(() => {
    const parsed = Number.parseFloat(amountInput.replace(',', '.'))
    if (!Number.isFinite(parsed) || parsed <= 0) return 0
    return Math.round(parsed * 100)
  }, [amountInput])

  async function handleCreate(): Promise<void> {
    if (amountCents < MIN_TOPUP_CENTS || createTopup.isPending) return
    setError(null)
    try {
      const result = await createTopup.mutateAsync({
        amountCents,
        method,
        idempotencyKey: generateIdempotencyKey()
      })
      triggerNotificationHaptic('success')
      if (result.redirectUrl) {
        openPaymentUrl(result.redirectUrl)
      }
    } catch {
      setError(t('common.error.generic'))
      triggerNotificationHaptic('error')
    }
  }

  return (
    <section id="topup" className="flex flex-col gap-2.5">
      <SectionLabel>{t('profile.topupSection')}</SectionLabel>

      <div className="grid grid-cols-2 gap-2.5">
        {TOPUP_METHODS.map((option) => {
          const isActive = method === option.value
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
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${
                  option.value === 'CRYPTOBOT' ? 'bg-[#26a17b] text-white' : 'bg-card-strong text-warning'
                }`}
              >
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
          placeholder="0.00"
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
        disabled={amountCents < MIN_TOPUP_CENTS || createTopup.isPending}
        className="rounded-full bg-cta py-3.5 text-center text-sm font-semibold text-cta-ink transition-opacity disabled:opacity-40"
      >
        {t('topup.confirm')}
      </button>

      {createTopup.data?.tron ? (
        <div className="flex flex-col items-center gap-3 rounded-card border border-line bg-card p-4">
          <QrCode value={`tron:${createTopup.data.tron.address}?amount=${createTopup.data.tron.amountUsdt6}`} />
          <p className="break-all text-center text-xs text-muted">{createTopup.data.tron.address}</p>
        </div>
      ) : null}

      {error ? <p className="text-center text-xs text-danger">{error}</p> : null}
      <p className="px-2 text-center text-[11px] leading-relaxed text-faint">{t('topup.hint')}</p>
    </section>
  )
}
