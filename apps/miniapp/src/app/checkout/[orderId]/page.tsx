'use client'

import { useParams, useRouter } from 'next/navigation'
import { useMemo } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { useBackButton } from '@/hooks/useBackButton'
import { useMainButton } from '@/hooks/useMainButton'
import { useOrderDetail } from '@/hooks/useApi'
import { CopyButton } from '@/components/CopyButton'
import { QrCode } from '@/components/QrCode'
import { ErrorState } from '@/components/States'
import { formatCents, formatDate } from '@/lib/format'
import { openPaymentUrl } from '@/lib/payments'
import { triggerHaptic } from '@/lib/TelegramProvider'
import type { DictionaryKey } from '@/i18n/dictionaries'
import type { OrderStatusSchema } from '@/types/api'
import type { z } from 'zod'

type OrderStatus = z.infer<typeof OrderStatusSchema>

/**
 * `as const` keeps each value as its concrete literal key, while `satisfies`
 * verifies at compile time that every order status is covered and that every
 * value is a real translation key.
 */
const STATUS_KEY = {
  PENDING: 'checkout.status.pending',
  PAID: 'checkout.status.paid',
  DELIVERING: 'checkout.status.delivering',
  DELIVERED: 'checkout.status.delivered',
  FAILED: 'checkout.status.failed',
  REFUNDED: 'checkout.status.refunded',
  EXPIRED: 'checkout.status.expired'
} as const satisfies Record<OrderStatus, DictionaryKey>

export default function CheckoutOrderPage(): JSX.Element {
  const params = useParams<{ orderId: string }>()
  const router = useRouter()
  const { t, locale } = useI18n()
  const { data, isLoading, isError, refetch } = useOrderDetail(params.orderId, true)

  useBackButton(true)

  const isTerminal = useMemo(() => {
    if (!data) return false
    return ['DELIVERED', 'FAILED', 'REFUNDED', 'EXPIRED'].includes(data.status)
  }, [data])

  useMainButton({
    text: t('common.continue'),
    isVisible: isTerminal,
    onClick: () => router.push('/orders')
  })

  if (isLoading) {
    return (
      <div className="page-enter flex flex-1 flex-col gap-4 px-4 pt-3">
        <div className="skeleton h-24 rounded-card" />
        <div className="skeleton h-48 rounded-card" />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <ErrorState title={t('common.error.network')} onRetry={() => void refetch()} retryLabel={t('common.retry')} />
    )
  }

  return (
    <div className="page-enter flex flex-1 flex-col gap-4 px-4 pb-4 pt-3">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">{t('checkout.title')}</h1>
      </header>

      <section className="flex flex-col gap-2 rounded-card border border-line bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-sm font-semibold text-ink">{data.productTitle}</p>
          <StatusPill status={data.status} label={t(STATUS_KEY[data.status])} />
        </div>
        <p className="text-xs text-muted">{data.planTitle}</p>
        <div className="flex items-center justify-between border-t border-line pt-2.5">
          <p className="text-xs text-faint">{formatDate(data.createdAt, locale)}</p>
          <p className="tnum text-sm font-bold text-ink">{formatCents(data.amountCents)}</p>
        </div>
      </section>

      {data.payUrl && data.status === 'PENDING' ? (
        <button
          type="button"
          onClick={() => {
            triggerHaptic('medium')
            openPaymentUrl(data.payUrl as string)
          }}
          className="rounded-full bg-cta py-3.5 text-center text-sm font-semibold text-cta-ink"
        >
          {t('checkout.pay')}
        </button>
      ) : null}

      {data.tron && data.status === 'PENDING' ? (
        <section className="flex flex-col items-center gap-3 rounded-card border border-line bg-card p-4">
          <p className="text-sm font-semibold text-ink">{t('checkout.tron.network')}</p>
          <QrCode value={`tron:${data.tron.address}?amount=${data.tron.amountUsdt6}`} />
          <div className="flex w-full items-center justify-between gap-2 rounded-xl bg-card-strong px-3 py-2.5">
            <p className="truncate text-xs text-ink">{data.tron.address}</p>
            <CopyButton value={data.tron.address} label={t('checkout.tron.copyAddress')} />
          </div>
          <div className="flex w-full items-center justify-between">
            <p className="text-sm text-muted">{t('checkout.tron.amount')}</p>
            <p className="tnum text-sm font-semibold text-ink">{data.tron.amountUsdt6} USDT</p>
          </div>
          <p className="animate-pulse text-xs text-faint">{t('checkout.tron.waiting')}</p>
        </section>
      ) : null}

      {data.paymentStatus === 'CONFIRMING' ? (
        <p className="text-center text-sm text-muted">{t('checkout.tron.confirming')}</p>
      ) : null}
      {data.paymentStatus === 'UNDERPAID' ? (
        <p className="text-center text-sm text-danger">{t('checkout.tron.underpaid')}</p>
      ) : null}

      {data.deliveredPayload ? (
        <section className="flex flex-col gap-2 rounded-card border border-line bg-card p-4">
          <p className="text-sm font-semibold text-ink">{t('checkout.deliveredPayload')}</p>
          <div className="flex items-center justify-between gap-2 rounded-xl bg-card-strong px-3 py-2.5">
            <p className="truncate text-xs text-ink">{data.deliveredPayload}</p>
            <CopyButton value={data.deliveredPayload} label={t('checkout.copyPayload')} />
          </div>
        </section>
      ) : null}

      {isTerminal ? (
        <button
          type="button"
          onClick={() => router.push('/orders')}
          className="rounded-lg border border-line-strong py-3.5 text-center text-sm font-semibold text-ink"
        >
          {t('common.continue')}
        </button>
      ) : null}
    </div>
  )
}

function StatusPill({ status, label }: { status: OrderStatus; label: string }): JSX.Element {
  const tone =
    status === 'DELIVERED' || status === 'PAID'
      ? 'bg-success/15 text-success'
      : status === 'FAILED' || status === 'EXPIRED'
        ? 'bg-danger/15 text-danger'
        : status === 'REFUNDED'
          ? 'bg-line text-muted'
          : 'bg-warning/15 text-warning'

  return <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>{label}</span>
}
