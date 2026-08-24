'use client'

import { useRouter } from 'next/navigation'
import { useI18n } from '@/i18n/I18nProvider'
import { formatCents, formatDate } from '@/lib/format'
import { triggerHaptic } from '@/lib/TelegramProvider'
import type { OrderListItem } from '@/types/api'
import { Icon } from './Icons'
import { StatusPill } from './StatusPill'

export function OrderRow({ order }: { order: OrderListItem }): JSX.Element {
  const router = useRouter()
  const { locale } = useI18n()

  return (
    <button
      type="button"
      onClick={() => {
        triggerHaptic('light')
        router.push(`/checkout/${order.id}`)
      }}
      className="flex w-full items-center gap-3 rounded-card border border-line bg-card p-3.5 text-left transition-colors active:bg-card-strong"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-card-strong text-muted">
        <Icon name="box" size={18} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-ink">{order.productTitle}</span>
        <span className="text-xs text-faint">
          {order.planTitle} · {formatDate(order.createdAt, locale)}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className="tnum text-sm font-semibold text-ink">{formatCents(order.amountCents)}</span>
        <StatusPill status={order.status} />
      </span>
    </button>
  )
}
