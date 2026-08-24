'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useI18n } from '@/i18n/I18nProvider'
import { api } from '@/lib/apiClient'
import { formatCents, formatDate } from '@/lib/format'
import { useTelegram } from '@/lib/TelegramProvider'
import { QueryGate } from '@/components/QueryGate'
import { SectionLabel } from '@/components/SectionLabel'
import { Skeleton } from '@/components/Skeletons'
import { StatusPill } from '@/components/StatusPill'
import { StatsResponseSchema, type OrderStatus, type RevenueWindow } from '@/types/api'

const REVENUE_WINDOWS = [
  { key: 'today', labelKey: 'dash.revenue.today' },
  { key: 'last7d', labelKey: 'dash.revenue.7d' },
  { key: 'last30d', labelKey: 'dash.revenue.30d' },
  { key: 'total', labelKey: 'dash.revenue.total' }
] as const

function DashboardSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-4 px-4 pt-2">
      <Skeleton className="h-44" />
      <Skeleton className="h-16" />
      <Skeleton className="h-24" />
      <Skeleton className="h-48" />
    </div>
  )
}

export default function DashboardPage(): JSX.Element {
  const { t, locale } = useI18n()
  const { isReady } = useTelegram()

  const statsQuery = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: () => api.get('/api/admin/stats', StatsResponseSchema),
    enabled: isReady
  })

  return (
    <main className="page-enter flex flex-col gap-5 pt-2">
      <QueryGate
        data={statsQuery.data}
        isLoading={statsQuery.isPending}
        error={statsQuery.error}
        onRetry={() => void statsQuery.refetch()}
        skeleton={<DashboardSkeleton />}
      >
        {(stats) => (
          <>
            <section className="relative mx-4 overflow-hidden rounded-[22px]">
              <div className="glass relative rounded-[22px] p-4">
                <div className="glass-sheen" aria-hidden />
                <SectionLabel>{t('dash.revenue')}</SectionLabel>
                <div className="mt-3 grid grid-cols-2 gap-2.5">
                  {REVENUE_WINDOWS.map(({ key, labelKey }) => {
                    const win: RevenueWindow = stats.revenue[key]
                    return (
                      <div key={key} className="tile rounded-tile p-3">
                        <p className="text-[11px] font-medium text-faint">{t(labelKey)}</p>
                        <p className="tnum mt-1 text-lg font-bold tracking-[-0.02em] text-ink">
                          {formatCents(win.grossCents)}
                        </p>
                        <p className="tnum mt-0.5 text-[11px] text-muted">
                          {t('dash.revenue.orders', { count: win.paidOrders })}
                        </p>
                        {win.refundedCents > 0 ? (
                          <p className="tnum mt-0.5 text-[11px] text-danger">
                            {t('dash.revenue.refunded', { amount: formatCents(win.refundedCents) })}
                          </p>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </div>
            </section>

            <section className="mx-4 flex flex-col gap-2.5">
              <SectionLabel>{t('dash.users')}</SectionLabel>
              <div className="grid grid-cols-3 gap-2.5">
                {(
                  [
                    ['dash.users.total', stats.users.total, 'text-ink'],
                    ['dash.users.new', stats.users.newToday, 'text-success'],
                    ['dash.users.blocked', stats.users.blocked, 'text-danger']
                  ] as const
                ).map(([labelKey, value, tone]) => (
                  <div key={labelKey} className="tile rounded-tile p-3 text-center">
                    <p className={`tnum text-lg font-bold ${tone}`}>{value}</p>
                    <p className="mt-0.5 text-[11px] text-faint">{t(labelKey)}</p>
                  </div>
                ))}
              </div>
            </section>

            {Object.keys(stats.ordersByStatus).length > 0 ? (
              <section className="mx-4 flex flex-col gap-2.5">
                <SectionLabel>{t('dash.ordersByStatus')}</SectionLabel>
                <div className="no-scrollbar flex gap-2 overflow-x-auto">
                  {Object.entries(stats.ordersByStatus).map(([status, count]) => (
                    <Link
                      key={status}
                      href={`/orders?status=${status}`}
                      className="chip flex shrink-0 items-center gap-2 rounded-full px-3 py-2"
                    >
                      <StatusPill status={status as OrderStatus} />
                      <span className="tnum text-sm font-semibold text-ink">{count}</span>
                    </Link>
                  ))}
                </div>
              </section>
            ) : null}

            {stats.lowStock.length > 0 ? (
              <section className="mx-4 flex flex-col gap-2.5">
                <SectionLabel>{t('dash.lowStock')}</SectionLabel>
                <div className="panel flex flex-col divide-y divide-line rounded-card">
                  {stats.lowStock.map((row) => (
                    <Link key={row.planId} href={`/catalog/stock/${row.planId}`} className="flex items-center justify-between gap-3 p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink">{row.productTitle}</p>
                        <p className="truncate text-xs text-muted">{row.planTitle}</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-warning/15 px-2.5 py-1 text-[11px] font-medium text-warning">
                        {t('dash.lowStock.left', { count: row.availableCount, threshold: row.lowStockThreshold })}
                      </span>
                    </Link>
                  ))}
                </div>
              </section>
            ) : null}

            {stats.pendingRefunds.length > 0 ? (
              <section className="mx-4 flex flex-col gap-2.5">
                <SectionLabel>{t('dash.pendingRefunds')}</SectionLabel>
                <div className="panel flex flex-col divide-y divide-line rounded-card">
                  {stats.pendingRefunds.map((row) => (
                    <Link key={row.orderId} href={`/orders/${row.orderId}`} className="flex items-center justify-between gap-3 p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink">{row.reason}</p>
                        <p className="truncate text-xs text-muted">
                          {t('dash.pendingRefunds.by', { actor: row.requestedBy })} · {formatDate(row.requestedAt, locale)}
                        </p>
                      </div>
                      <span className="tnum shrink-0 text-sm font-bold text-warning">{formatCents(row.amountCents)}</span>
                    </Link>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="mx-4 flex flex-col gap-2.5">
              <SectionLabel>{t('dash.recent')}</SectionLabel>
              {stats.recentOrders.length === 0 ? (
                <p className="px-1 text-sm text-muted">{t('dash.recent.empty')}</p>
              ) : (
                <div className="panel flex flex-col divide-y divide-line rounded-card">
                  {stats.recentOrders.map((order) => (
                    <Link key={order.id} href={`/orders/${order.id}`} className="flex items-center justify-between gap-3 p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink">{order.productTitle}</p>
                        <p className="truncate text-xs text-muted">
                          {order.planTitle} · {order.user.username ? `@${order.user.username}` : order.user.firstName ?? order.user.tgId}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="tnum text-sm font-bold text-ink">{formatCents(order.amountCents)}</span>
                        <StatusPill status={order.status} />
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </QueryGate>
    </main>
  )
}
