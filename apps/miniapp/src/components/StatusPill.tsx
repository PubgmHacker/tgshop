'use client'

import { useI18n } from '@/i18n/I18nProvider'
import type { OrderListItem } from '@/types/api'

type OrderStatus = OrderListItem['status']

export function StatusPill({ status }: { status: OrderStatus }): JSX.Element {
  const { t } = useI18n()
  const tone =
    status === 'DELIVERED' || status === 'PAID'
      ? 'bg-success/15 text-success'
      : status === 'FAILED' || status === 'EXPIRED'
        ? 'bg-danger/15 text-danger'
        : status === 'REFUNDED'
          ? 'bg-line text-muted'
          : 'bg-warning/15 text-warning'

  return (
    <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium ${tone}`}>
      {t(`order.status.${status}`)}
    </span>
  )
}
