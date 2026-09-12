'use client'

import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/i18n/I18nProvider'
import { api, ApiClientError } from '@/lib/apiClient'
import { formatDate } from '@/lib/format'
import { triggerHaptic, triggerNotificationHaptic, useTelegram } from '@/lib/TelegramProvider'
import { FormError } from '@/components/Form'
import { Icon } from '@/components/Icons'
import { QueryGate } from '@/components/QueryGate'
import { Skeleton } from '@/components/Skeletons'
import { StockAddResponseSchema, StockDeleteResponseSchema, StockDetailResponseSchema } from '@/types/api'

function StockSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-4 px-4 pt-2">
      <Skeleton className="h-24" />
      <Skeleton className="h-40" />
      <Skeleton className="h-48" />
    </div>
  )
}

export default function StockPage(): JSX.Element {
  const params = useParams<{ planId: string }>()
  const planId = params.planId
  const { t, locale } = useI18n()
  const { isReady } = useTelegram()
  const queryClient = useQueryClient()

  const [lines, setLines] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [addedCount, setAddedCount] = useState<number | null>(null)

  const stockQuery = useQuery({
    queryKey: ['admin', 'stock', planId],
    queryFn: () => api.get(`/api/admin/plans/${planId}/stock`, StockDetailResponseSchema),
    enabled: isReady && Boolean(planId)
  })

  function invalidate(): void {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'stock', planId] })
    void queryClient.invalidateQueries({ queryKey: ['admin', 'catalog'] })
    void queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] })
  }

  const addStock = useMutation({
    mutationFn: (payload: string[]) =>
      api.post(`/api/admin/plans/${planId}/stock`, StockAddResponseSchema, { lines: payload }),
    onSuccess: (result) => {
      triggerNotificationHaptic('success')
      setLines('')
      setFormError(null)
      setAddedCount(result.added)
      invalidate()
    },
    onError: (error) => {
      triggerNotificationHaptic('error')
      setAddedCount(null)
      setFormError(error instanceof ApiClientError ? error.message : t('common.error.generic'))
    }
  })

  const deleteItem = useMutation({
    mutationFn: (itemId: string) => api.del(`/api/admin/stock/${itemId}`, StockDeleteResponseSchema),
    onSuccess: () => {
      triggerNotificationHaptic('success')
      setFormError(null)
      invalidate()
    },
    onError: (error) => {
      triggerNotificationHaptic('error')
      setFormError(error instanceof ApiClientError ? error.message : t('common.error.generic'))
    }
  })

  const parsedLines = lines
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  return (
    <main className="page-enter flex flex-col gap-4 pt-2">
      <QueryGate
        data={stockQuery.data}
        isLoading={stockQuery.isPending}
        error={stockQuery.error}
        onRetry={() => void stockQuery.refetch()}
        skeleton={<StockSkeleton />}
      >
        {({ plan, counts, recent }) => (plan.usesStock ?? (plan.deliveryType === 'STOCK_POOL' || plan.deliveryType === 'UNIQUE_CODE')) ? (
          <>
            <section className="relative mx-4 overflow-hidden rounded-[22px]">
              <div className="glass relative rounded-[22px] p-4">
                <div className="glass-sheen" aria-hidden />
                <p className="text-[11px] font-medium uppercase tracking-wide text-faint">{t('stock.title')}</p>
                <p className="mt-1 truncate text-lg font-bold tracking-[-0.02em] text-ink">{plan.productTitle}</p>
                <p className="truncate text-sm text-muted">
                  {plan.title} · {t(`delivery.${plan.deliveryType}`)} ·{' '}
                  {t('stock.threshold', { count: plan.lowStockThreshold })}
                </p>
                <div className="mt-3 grid grid-cols-3 gap-2.5">
                  {(
                    [
                      ['stock.available', counts.available, counts.available <= plan.lowStockThreshold ? 'text-warning' : 'text-success'],
                      ['stock.reserved', counts.reserved, 'text-ink'],
                      ['stock.sold', counts.sold, 'text-muted']
                    ] as const
                  ).map(([labelKey, value, tone]) => (
                    <div key={labelKey} className="tile rounded-tile p-3 text-center">
                      <p className={`tnum text-lg font-bold ${tone}`}>{value}</p>
                      <p className="mt-0.5 text-[11px] text-faint">{t(labelKey)}</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="mx-4 flex flex-col gap-2.5">
              <p className="text-[13px] font-medium text-muted">{t('stock.add')}</p>
              <textarea
                value={lines}
                onChange={(event) => {
                  setLines(event.target.value)
                  setAddedCount(null)
                }}
                placeholder={t('stock.lines.placeholder')}
                rows={5}
                className="tile w-full resize-none rounded-tile px-3.5 py-3 font-mono text-[13px] text-ink outline-none placeholder:font-sans placeholder:text-faint"
              />
              <p className="text-xs text-faint">{t('stock.lines.hint')}</p>
              <FormError message={formError} />
              {addedCount !== null ? (
                <p className="text-sm font-medium text-success">{t('stock.added', { count: addedCount })}</p>
              ) : null}
              <button
                type="button"
                disabled={parsedLines.length === 0 || addStock.isPending}
                onClick={() => {
                  triggerHaptic('medium')
                  addStock.mutate(parsedLines)
                }}
                className="btn-primary w-full rounded-full px-4 py-3.5 text-sm font-bold text-cta-ink disabled:opacity-60"
              >
                {addStock.isPending ? t('common.loading') : `${t('common.add')} (${parsedLines.length})`}
              </button>
            </section>

            <section className="mx-4 flex flex-col gap-2.5">
              <p className="text-[13px] font-medium text-muted">{t('stock.recent')}</p>
              {recent.length === 0 ? (
                <p className="panel rounded-card px-3 py-3 text-sm text-muted">{t('stock.empty')}</p>
              ) : (
                <div className="panel flex flex-col divide-y divide-line rounded-card">
                  {recent.map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-3 p-3">
                      <div className="min-w-0">
                        <p className="tnum truncate text-[12px] font-medium text-ink">{item.id}</p>
                        <p className="text-xs text-muted">{formatDate(item.createdAt, locale)}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span
                          className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                            item.status === 'AVAILABLE'
                              ? 'bg-success/15 text-success'
                              : item.status === 'RESERVED'
                                ? 'bg-warning/15 text-warning'
                                : 'bg-line text-muted'
                          }`}
                        >
                          {t(`stock.status.${item.status}`)}
                        </span>
                        {item.status === 'AVAILABLE' ? (
                          <button
                            type="button"
                            disabled={deleteItem.isPending}
                            aria-label={t('common.delete')}
                            onClick={() => {
                              if (window.confirm(t('stock.delete.confirm'))) {
                                deleteItem.mutate(item.id)
                              }
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-full bg-danger/15 text-danger disabled:opacity-60"
                          >
                            <Icon name="close" size={14} />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : (
          <section className="mx-4 flex flex-col gap-3 rounded-card border border-line bg-card p-5">
            <h1 className="text-lg font-semibold text-ink">{plan.productTitle}</h1>
            <p className="text-sm text-muted">{t('plan.stockNotUsed')}</p>
            <Link href={`/catalog/product/${plan.productId}`} className="btn-primary min-h-11 rounded-full px-4 text-sm font-semibold">{t('common.back')}</Link>
          </section>
        )}
      </QueryGate>
    </main>
  )
}
