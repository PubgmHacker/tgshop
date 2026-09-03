'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { useConfigData, useCreateTopup, useTopupDetail } from '@/hooks/useApi'
import { useCountdown } from '@/hooks/useCountdown'
import { formatCents, generateIdempotencyKey } from '@/lib/format'
import { errorMessageKey, mayHaveReachedServer } from '@/lib/errors'
import { openPaymentUrl } from '@/lib/payments'
import { triggerHaptic, triggerNotificationHaptic } from '@/lib/TelegramProvider'
import type { CreateTopupResponse, TopupMethod } from '@/types/api'
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

const MAX_TOPUP_CENTS = 1_000_000

/** The invoice this panel is currently following; replaced only by an explicit "new invoice". */
interface ActiveTopup {
  amountCents: number
  method: TopupMethod
  created: CreateTopupResponse
}

function parseAmountCents(input: string): number {
  const normalized = input.replace(',', '.').trim()
  if (!/^\d*(?:\.\d{0,2})?$/.test(normalized) || normalized === '' || normalized === '.') return 0
  const parsed = Number.parseFloat(normalized)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return Math.round(parsed * 100)
}

export function TopupPanel(): JSX.Element {
  const { t } = useI18n()
  const config = useConfigData()
  const [method, setMethod] = useState<TopupMethod>('STARS')
  const [amountInput, setAmountInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState<ActiveTopup | null>(null)
  const createTopup = useCreateTopup()
  // One key per attempt: a retry after a network failure reuses it so the server
  // can answer with the invoice it may already have created.
  const idempotencyKeyRef = useRef<string | null>(null)

  const availableMethodValues: TopupMethod[] = config.data?.topupMethods ?? ['STARS']
  const availableMethods = TOPUP_METHODS.filter((option) => availableMethodValues.includes(option.value))
  const selectedMethod = availableMethodValues.includes(method) ? method : (availableMethodValues[0] ?? 'STARS')
  const minTopupCents = config.data?.minTopupCents ?? 500

  const amountCents = useMemo(() => parseAmountCents(amountInput), [amountInput])
  const amountTooSmall = amountCents > 0 && amountCents < minTopupCents
  const amountTooLarge = amountCents > MAX_TOPUP_CENTS
  const canCreate =
    amountCents >= minTopupCents && !amountTooLarge && !createTopup.isPending && availableMethods.length > 0

  function resetAttempt(): void {
    idempotencyKeyRef.current = null
    setError(null)
  }

  async function handleCreate(): Promise<void> {
    if (!canCreate) return
    setError(null)
    idempotencyKeyRef.current ??= generateIdempotencyKey()
    try {
      const created = await createTopup.mutateAsync({
        amountCents,
        method: selectedMethod,
        idempotencyKey: idempotencyKeyRef.current
      })
      idempotencyKeyRef.current = null
      triggerNotificationHaptic('success')
      setActive({ amountCents, method: selectedMethod, created })
      if (created.redirectUrl) openPaymentUrl(created.redirectUrl)
    } catch (err) {
      if (!mayHaveReachedServer(err)) idempotencyKeyRef.current = null
      setError(t(errorMessageKey(err)))
      triggerNotificationHaptic('error')
    }
  }

  if (active) {
    return (
      <section id="topup" className="flex flex-col gap-2.5">
        <SectionLabel>{t('profile.topupSection')}</SectionLabel>
        <ActiveInvoice
          active={active}
          onNew={() => {
            triggerHaptic('light')
            setActive(null)
            setAmountInput('')
            resetAttempt()
          }}
        />
      </section>
    )
  }

  return (
    <section id="topup" className="flex flex-col gap-2.5">
      <SectionLabel>{t('profile.topupSection')}</SectionLabel>

      <div role="group" aria-label={t('checkout.method')} className="grid grid-cols-2 gap-2.5">
        {availableMethods.map((option) => {
          const isActive = selectedMethod === option.value
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={isActive}
              onClick={() => {
                triggerHaptic('light')
                setMethod(option.value)
                resetAttempt()
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
          type="text"
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="done"
          placeholder={(minTopupCents / 100).toFixed(2)}
          aria-label={t('topup.amount')}
          aria-invalid={amountTooSmall || amountTooLarge}
          value={amountInput}
          onChange={(e) => {
            setAmountInput(e.target.value)
            resetAttempt()
          }}
          className="tnum w-full bg-transparent text-sm text-ink outline-none placeholder:text-faint"
        />
        <span className="text-xs font-semibold text-faint">USD</span>
      </label>

      {amountCents > 0 ? (
        <div className="flex items-center justify-between rounded-card border border-line bg-card px-4 py-3 text-xs">
          <span className="text-muted">{t('topup.totalDue')}</span>
          <span className="tnum font-semibold text-ink">{formatCents(amountCents)}</span>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => void handleCreate()}
        disabled={!canCreate}
        aria-busy={createTopup.isPending}
        className="rounded-full bg-cta py-3.5 text-center text-sm font-semibold text-cta-ink transition-opacity disabled:opacity-40"
      >
        {createTopup.isPending ? t('common.loading') : t('topup.confirm')}
      </button>

      {availableMethods.length === 0 ? <p className="text-center text-xs text-muted">{t('topup.noMethods')}</p> : null}
      {amountTooSmall ? (
        <p className="text-center text-xs text-muted">{t('topup.minAmount', { amount: formatCents(minTopupCents) })}</p>
      ) : null}
      {amountTooLarge ? (
        <p className="text-center text-xs text-muted">{t('topup.maxAmount', { amount: formatCents(MAX_TOPUP_CENTS) })}</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-center text-xs text-danger">
          {error}
        </p>
      ) : null}
      <p className="px-2 text-center text-[11px] leading-relaxed text-faint">{t('topup.hint')}</p>
    </section>
  )
}

function ActiveInvoice({ active, onNew }: { active: ActiveTopup; onNew: () => void }): JSX.Element {
  const { t } = useI18n()
  const detail = useTopupDetail(active.created.paymentId)
  // The freshest server view wins; before the first poll answers, the creation response stands in.
  const current = detail.data ?? active.created
  const status = current.status
  const tron = current.tron ?? (status === 'PENDING' || status === 'CONFIRMING' ? active.created.tron : null)
  const redirectUrl = current.redirectUrl ?? (status === 'PENDING' ? active.created.redirectUrl : null)
  const countdown = useCountdown(tron?.expiresAt ?? null)
  const isOpen = status === 'PENDING' || status === 'CONFIRMING'
  const windowClosed = status === 'EXPIRED' || (status === 'PENDING' && countdown.isExpired)
  const amountLabel = formatCents(active.amountCents)

  const announcedRef = useRef<string | null>(null)
  useEffect(() => {
    if (announcedRef.current === status) return
    announcedRef.current = status
    if (status === 'PAID') triggerNotificationHaptic('success')
    if (status === 'FAILED' || status === 'UNDERPAID' || status === 'EXPIRED') triggerNotificationHaptic('error')
  }, [status])

  if (status === 'PAID') {
    return (
      <div role="status" className="flex flex-col items-center gap-3 rounded-card border border-line bg-card p-5 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-success/15 text-success">✓</span>
        <p className="text-sm font-semibold text-ink">{t('topup.success', { amount: amountLabel })}</p>
        <button type="button" onClick={onNew} className="rounded-full border border-line-strong px-5 py-2.5 text-sm font-semibold text-ink">
          {t('topup.again')}
        </button>
      </div>
    )
  }

  if (!isOpen || windowClosed) {
    const message =
      status === 'UNDERPAID' ? t('checkout.tron.underpaid') : windowClosed ? t('topup.expired') : t('topup.failed')
    return (
      <div role="alert" className="flex flex-col items-center gap-3 rounded-card border border-line bg-card p-5 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-danger/15 text-danger">!</span>
        <p className="text-sm font-semibold text-ink">{t('topup.invoiceFor', { amount: amountLabel })}</p>
        <p className="text-xs leading-relaxed text-muted">{message}</p>
        <button type="button" onClick={onNew} className="rounded-full bg-cta px-5 py-2.5 text-sm font-semibold text-cta-ink">
          {t('topup.newInvoice')}
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-card border border-line bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-ink">{t('topup.invoiceFor', { amount: amountLabel })}</p>
        {tron ? (
          <span className="tnum shrink-0 rounded-full bg-warning/15 px-2.5 py-1 text-xs font-medium text-warning">
            {t('checkout.tron.timeLeft', { time: countdown.label })}
          </span>
        ) : null}
      </div>

      {tron ? (
        <div className="flex flex-col items-center gap-3">
          <p className="text-xs text-muted">{t('checkout.tron.network')}</p>
          <QrCode value={tron.address} alt={t('common.qrAlt')} />
          <div className="flex w-full items-center justify-between gap-2 rounded-xl bg-card-strong px-3 py-2.5">
            <p className="min-w-0 break-all text-xs text-ink">{tron.address}</p>
            <CopyButton value={tron.address} label={t('checkout.tron.copyAddress')} />
          </div>
          <div className="flex w-full items-center justify-between gap-2 rounded-xl bg-card-strong px-3 py-2.5">
            <div className="flex min-w-0 flex-col">
              <p className="text-xs text-muted">{t('checkout.tron.amount')}</p>
              <p className="tnum text-base font-semibold text-ink">{tron.amountDisplay} USDT</p>
            </div>
            <CopyButton value={tron.amountDisplay} label={t('checkout.tron.copyAmount')} />
          </div>
          <p className="text-center text-xs leading-relaxed text-danger">{t('checkout.tron.exact')}</p>
        </div>
      ) : null}

      {redirectUrl ? (
        <button
          type="button"
          onClick={() => {
            triggerHaptic('medium')
            openPaymentUrl(redirectUrl)
          }}
          className="rounded-full bg-cta py-3.5 text-center text-sm font-semibold text-cta-ink"
        >
          {t('topup.openPayment')}
        </button>
      ) : null}

      <div role="status" className="flex flex-col items-center gap-1 text-center">
        <p className="animate-pulse text-xs text-faint">
          {status === 'CONFIRMING' ? t('checkout.tron.confirming') : t('topup.waiting')}
        </p>
        <p className="text-[11px] leading-relaxed text-faint">{t('topup.waitingHint')}</p>
      </div>

      <button type="button" onClick={onNew} className="py-1 text-center text-xs font-semibold text-muted">
        {t('topup.newInvoice')}
      </button>
    </div>
  )
}
