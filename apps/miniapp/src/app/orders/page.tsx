'use client'

import { useMemo, useState } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { errorMessageKey } from '@/lib/errors'
import { useBackButton } from '@/hooks/useBackButton'
import { useProfileData } from '@/hooks/useApi'
import { OrderRow } from '@/components/OrderRow'
import { ErrorState } from '@/components/States'
import { triggerHaptic } from '@/lib/TelegramProvider'
import type { OrderListItem } from '@/types/api'

type OrdersFilter = 'all' | 'delivered' | 'pending'

const PENDING_STATUSES: readonly OrderListItem['status'][] = ['PENDING', 'PAID', 'DELIVERING']

const FILTERS: { value: OrdersFilter; labelKey: 'orders.filter.all' | 'orders.filter.delivered' | 'orders.filter.pending' }[] = [
  { value: 'all', labelKey: 'orders.filter.all' },
  { value: 'delivered', labelKey: 'orders.filter.delivered' },
  { value: 'pending', labelKey: 'orders.filter.pending' }
]

export default function OrdersPage(): JSX.Element {
  const { t } = useI18n()
  const { data, isLoading, isError, error, refetch } = useProfileData()
  const [filter, setFilter] = useState<OrdersFilter>('all')

  useBackButton(false)

  const orders = useMemo(() => {
    const all = data?.orders ?? []
    if (filter === 'delivered') return all.filter((order) => order.status === 'DELIVERED')
    if (filter === 'pending') return all.filter((order) => PENDING_STATUSES.includes(order.status))
    return all
  }, [data, filter])

  return (
    <div className="page-enter flex flex-1 flex-col gap-4 px-4 pt-3">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">{t('orders.title')}</h1>
        <p className="text-xs leading-relaxed text-muted">{t('orders.subtitle')}</p>
      </header>

      <div className="flex gap-2">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={filter === option.value}
            onClick={() => {
              triggerHaptic('light')
              setFilter(option.value)
            }}
            className={`rounded-full border px-4 py-2 text-xs font-medium transition-colors ${
              filter === option.value
                ? 'border-transparent bg-cta text-cta-ink'
                : 'border-line bg-card text-muted active:bg-card-strong'
            }`}
          >
            {t(option.labelKey)}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-[68px] rounded-card" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState title={t(errorMessageKey(error))} onRetry={() => void refetch()} retryLabel={t('common.retry')} />
      ) : orders.length === 0 ? (
        <div className="rounded-card border border-line bg-card px-4 py-8 text-center text-sm text-faint">
          {t('orders.empty')}
        </div>
      ) : (
        <div className="flex flex-col gap-2 pb-4">
          {orders.map((order) => (
            <OrderRow key={order.id} order={order} />
          ))}
        </div>
      )}
    </div>
  )
}
