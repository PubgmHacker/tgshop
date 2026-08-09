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
import { formatDate } from '@/lib/format'
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
    onClick: () => router.push('/profile')
  })

  if (isLoading) {
    return (
      <div className="page-enter flex flex-1 flex-col gap-4 pt-4">
        <div className="mx-4 skeleton h-24 rounded-card" />
        <div className="mx-4 skeleton h-48 rounded-card" />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <ErrorState title={t('common.error.network')} onRetry={() => void refetch()} retryLabel={t('common.retry')} />
    )
  }

  return (
    <div className="page-enter flex flex-1 flex-col gap-4 pt-4">
      <header className="px-4">
        <h1 className="text-xl font-bold text-tg-text">{t('checkout.title')}</h1>
      </header>

      <section className="mx-4 flex flex-col gap-2 rounded-card bg-tg-section-bg p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-tg-hint">{data.productTitle}</p>
          <StatusPill status={data.status} label={t(STATUS_KEY[data.status])} />
        </div>
        <p className="text-sm font-medium text-tg-text">{data.planTitle}</p>
        <p className="text-xs text-tg-hint">{formatDate(data.createdAt, locale)}</p>
      </section>

      {data.tron && data.status === 'PENDING' ? (
        <section className="mx-4 flex flex-col items-center gap-3 rounded-card bg-tg-section-bg p-4">
          <p className="text-sm font-semibold text-tg-text">{t('checkout.tron.network')}</p>
          <QrCode value={`tron:${data.tron.address}?amount=${data.tron.amountUsdt6}`} />
          <div className="flex w-full items-center justify-between gap-2 rounded-lg bg-tg-secondary-bg px-3 py-2">
            <p className="truncate text-xs text-tg-text">{data.tron.address}</p>
            <CopyButton value={data.tron.address} label={t('checkout.tron.copyAddress')} />
          </div>
          <div className="flex w-full items-center justify-between">
            <p className="text-sm text-tg-hint">{t('checkout.tron.amount')}</p>
            <p className="text-sm font-semibold text-tg-text">{data.tron.amountUsdt6} USDT</p>
          </div>
          <p className="animate-pulse text-xs text-tg-hint">{t('checkout.tron.waiting')}</p>
        </section>
      ) : null}

      {data.paymentStatus === 'CONFIRMING' ? (
        <p className="px-4 text-center text-sm text-tg-hint">{t('checkout.tron.confirming')}</p>
      ) : null}
      {data.paymentStatus === 'UNDERPAID' ? (
        <p className="px-4 text-center text-sm text-tg-destructive">{t('checkout.tron.underpaid')}</p>
      ) : null}

      {data.deliveredPayload ? (
        <section className="mx-4 flex flex-col gap-2 rounded-card bg-tg-section-bg p-4">
          <p className="text-sm font-semibold text-tg-text">{t('checkout.deliveredPayload')}</p>
          <div className="flex items-center justify-between gap-2 rounded-lg bg-tg-secondary-bg px-3 py-2">
            <p className="truncate text-xs text-tg-text">{data.deliveredPayload}</p>
            <CopyButton value={data.deliveredPayload} label={t('checkout.copyPayload')} />
          </div>
        </section>
      ) : null}

      {isTerminal ? (
        <div className="px-4 pb-2">
          <button
            type="button"
            onClick={() => router.push('/profile')}
            className="w-full rounded-full bg-tg-button py-3 text-center text-sm font-semibold text-tg-button-text"
          >
            {t('common.continue')}
          </button>
        </div>
      ) : null}
    </div>
  )
}

function StatusPill({ status, label }: { status: OrderStatus; label: string }): JSX.Element {
  const tone =
    status === 'DELIVERED' || status === 'PAID'
      ? 'bg-emerald-500/15 text-emerald-400'
      : status === 'FAILED' || status === 'EXPIRED'
        ? 'bg-red-500/15 text-red-400'
        : 'bg-amber-500/15 text-amber-400'

  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>{label}</span>
}
