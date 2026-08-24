'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useI18n } from '@/i18n/I18nProvider'
import { api } from '@/lib/apiClient'
import { formatCents, formatDate } from '@/lib/format'
import { triggerHaptic, useTelegram } from '@/lib/TelegramProvider'
import { Icon } from '@/components/Icons'
import { QueryGate } from '@/components/QueryGate'
import { ListRowSkeleton } from '@/components/Skeletons'
import { EmptyState } from '@/components/States'
import { StatusPill } from '@/components/StatusPill'
import { OrderListResponseSchema, OrderStatusSchema, type OrderStatus } from '@/types/api'

const STATUSES = OrderStatusSchema.options

function ordersPath(status: OrderStatus | null, q: string, cursor: string | null): string {
  const params = new URLSearchParams({ limit: '30' })
  if (status) params.set('status', status)
  if (q) params.set('q', q)
  if (cursor) params.set('cursor', cursor)
  return `/api/admin/orders?${params.toString()}`
}

function ListSkeleton(): JSX.Element {
  return (
    <div className="panel mx-4 flex flex-col divide-y divide-line rounded-card">
      <ListRowSkeleton />
      <ListRowSkeleton />
      <ListRowSkeleton />
      <ListRowSkeleton />
    </div>
  )
}

function OrdersScreen(): JSX.Element {
  const { t, locale } = useI18n()
  const { isReady } = useTelegram()
  const searchParams = useSearchParams()

  const statusParam = searchParams.get('status')
  const initialStatus = OrderStatusSchema.safeParse(statusParam)
  const [status, setStatus] = useState<OrderStatus | null>(initialStatus.success ? initialStatus.data : null)
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')

  useEffect(() => {
    const handle = setTimeout(() => setQ(search.trim()), 400)
    return () => clearTimeout(handle)
  }, [search])

  const ordersQuery = useInfiniteQuery({
    queryKey: ['admin', 'orders', status, q],
    queryFn: ({ pageParam }) => api.get(ordersPath(status, q, pageParam), OrderListResponseSchema),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: isReady
  })

  return (
    <main className="page-enter flex flex-col gap-4 pt-2">
      <div className="mx-4 flex flex-col gap-1">
        <h1 className="text-xl font-bold tracking-[-0.02em] text-ink">{t('orders.title')}</h1>
        <p className="text-sm text-muted">{t('orders.subtitle')}</p>
      </div>

      <div className="tile mx-4 flex items-center gap-2 rounded-full px-4 py-2.5">
        <Icon name="search" size={16} className="shrink-0 text-faint" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('orders.search')}
          className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-faint"
        />
      </div>

      <div className="no-scrollbar flex gap-2 overflow-x-auto px-4">
        <button
          type="button"
          onClick={() => {
            triggerHaptic('light')
            setStatus(null)
          }}
          className={`chip shrink-0 rounded-full px-3.5 py-2 text-[13px] font-semibold ${status === null ? 'text-ink' : 'text-faint'}`}
        >
          {t('common.all')}
        </button>
        {STATUSES.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              triggerHaptic('light')
              setStatus(option)
            }}
            className={`chip shrink-0 rounded-full px-3.5 py-2 text-[13px] font-semibold ${status === option ? 'text-ink' : 'text-faint'}`}
          >
            {t(`order.status.${option}`)}
          </button>
        ))}
      </div>

      <QueryGate
        data={ordersQuery.data}
        isLoading={ordersQuery.isPending}
        error={ordersQuery.error}
        onRetry={() => void ordersQuery.refetch()}
        skeleton={<ListSkeleton />}
      >
        {(data) => {
          const orders = data.pages.flatMap((page) => page.orders)
          if (orders.length === 0) {
            return <EmptyState icon="bag" title={t('orders.empty')} />
          }
          return (
            <>
              <div className="panel mx-4 flex flex-col divide-y divide-line rounded-card">
                {orders.map((order) => (
                  <Link key={order.id} href={`/orders/${order.id}`} className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">
                        {order.productTitle} · {order.planTitle}
                      </p>
                      <p className="truncate text-xs text-muted">
                        {order.user.username ? `@${order.user.username}` : order.user.firstName ?? order.user.tgId} ·{' '}
                        {t(`provider.${order.provider}`)} · {formatDate(order.createdAt, locale)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="tnum text-sm font-bold text-ink">{formatCents(order.amountCents)}</span>
                      <StatusPill status={order.status} />
                    </div>
                  </Link>
                ))}
              </div>
              {ordersQuery.hasNextPage ? (
                <button
                  type="button"
                  disabled={ordersQuery.isFetchingNextPage}
                  onClick={() => {
                    triggerHaptic('light')
                    void ordersQuery.fetchNextPage()
                  }}
                  className="btn-ghost mx-4 rounded-full px-4 py-3 text-sm font-semibold text-ink disabled:opacity-60"
                >
                  {ordersQuery.isFetchingNextPage ? t('common.loading') : t('common.loadMore')}
                </button>
              ) : null}
            </>
          )
        }}
      </QueryGate>
    </main>
  )
}

export default function OrdersPage(): JSX.Element {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <OrdersScreen />
    </Suspense>
  )
}
