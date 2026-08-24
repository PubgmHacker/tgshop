'use client'

import { useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useI18n } from '@/i18n/I18nProvider'
import { api } from '@/lib/apiClient'
import { formatDate } from '@/lib/format'
import { triggerHaptic, useTelegram } from '@/lib/TelegramProvider'
import { QueryGate } from '@/components/QueryGate'
import { ListRowSkeleton } from '@/components/Skeletons'
import { EmptyState } from '@/components/States'
import { AuditResponseSchema } from '@/types/api'

function auditPath(cursor: string | null): string {
  const params = new URLSearchParams({ limit: '30' })
  if (cursor) params.set('cursor', cursor)
  return `/api/admin/audit?${params.toString()}`
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

export default function AuditPage(): JSX.Element {
  const { t, locale } = useI18n()
  const { isReady } = useTelegram()
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const auditQuery = useInfiniteQuery({
    queryKey: ['admin', 'audit'],
    queryFn: ({ pageParam }) => api.get(auditPath(pageParam), AuditResponseSchema),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: isReady
  })

  return (
    <main className="page-enter flex flex-col gap-4 pt-2">
      <div className="mx-4 flex flex-col gap-1">
        <h1 className="text-xl font-bold tracking-[-0.02em] text-ink">{t('audit.title')}</h1>
      </div>

      <QueryGate
        data={auditQuery.data}
        isLoading={auditQuery.isPending}
        error={auditQuery.error}
        onRetry={() => void auditQuery.refetch()}
        skeleton={<ListSkeleton />}
      >
        {(data) => {
          const entries = data.pages.flatMap((page) => page.entries)
          if (entries.length === 0) {
            return <EmptyState icon="clock" title={t('audit.empty')} />
          }
          return (
            <>
              <div className="panel mx-4 flex flex-col divide-y divide-line rounded-card">
                {entries.map((entry) => {
                  const isOpen = Boolean(expanded[entry.id])
                  const hasDiff = entry.diff !== null && entry.diff !== undefined
                  return (
                    <div key={entry.id} className="flex flex-col">
                      <button
                        type="button"
                        onClick={() => {
                          if (!hasDiff) return
                          triggerHaptic('light')
                          setExpanded((prev) => ({ ...prev, [entry.id]: !prev[entry.id] }))
                        }}
                        className="flex items-center justify-between gap-3 p-3 text-left"
                      >
                        <div className="min-w-0">
                          <p className="tnum truncate text-sm font-semibold text-ink">{entry.action}</p>
                          <p className="tnum truncate text-xs text-muted">
                            {entry.entity} · {entry.entityId} · {entry.actorType}:{entry.actorId}
                          </p>
                        </div>
                        <span className="shrink-0 text-xs text-faint">{formatDate(entry.createdAt, locale)}</span>
                      </button>
                      {isOpen && hasDiff ? (
                        <pre className="tnum mx-3 mb-3 overflow-x-auto rounded-tile bg-card-strong p-3 text-[11px] leading-relaxed text-muted">
                          {JSON.stringify(entry.diff, null, 2)}
                        </pre>
                      ) : null}
                    </div>
                  )
                })}
              </div>
              {auditQuery.hasNextPage ? (
                <button
                  type="button"
                  disabled={auditQuery.isFetchingNextPage}
                  onClick={() => {
                    triggerHaptic('light')
                    void auditQuery.fetchNextPage()
                  }}
                  className="btn-ghost mx-4 rounded-full px-4 py-3 text-sm font-semibold text-ink disabled:opacity-60"
                >
                  {auditQuery.isFetchingNextPage ? t('common.loading') : t('common.loadMore')}
                </button>
              ) : null}
            </>
          )
        }}
      </QueryGate>
    </main>
  )
}
