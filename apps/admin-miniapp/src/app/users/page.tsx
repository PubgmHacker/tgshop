'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useI18n } from '@/i18n/I18nProvider'
import { api } from '@/lib/apiClient'
import { formatDate } from '@/lib/format'
import { triggerHaptic, useTelegram } from '@/lib/TelegramProvider'
import { Icon } from '@/components/Icons'
import { QueryGate } from '@/components/QueryGate'
import { ListRowSkeleton } from '@/components/Skeletons'
import { EmptyState } from '@/components/States'
import { UserListResponseSchema } from '@/types/api'

function usersPath(q: string, blockedOnly: boolean, cursor: string | null): string {
  const params = new URLSearchParams({ limit: '30' })
  if (q) params.set('q', q)
  if (blockedOnly) params.set('blocked', 'true')
  if (cursor) params.set('cursor', cursor)
  return `/api/admin/users?${params.toString()}`
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

export default function UsersPage(): JSX.Element {
  const { t, locale } = useI18n()
  const { isReady } = useTelegram()

  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [blockedOnly, setBlockedOnly] = useState(false)

  useEffect(() => {
    const handle = setTimeout(() => setQ(search.trim()), 400)
    return () => clearTimeout(handle)
  }, [search])

  const usersQuery = useInfiniteQuery({
    queryKey: ['admin', 'users', q, blockedOnly],
    queryFn: ({ pageParam }) => api.get(usersPath(q, blockedOnly, pageParam), UserListResponseSchema),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: isReady
  })

  return (
    <main className="page-enter flex flex-col gap-4 pt-2">
      <div className="mx-4 flex flex-col gap-1">
        <h1 className="text-xl font-bold tracking-[-0.02em] text-ink">{t('users.title')}</h1>
        <p className="text-sm text-muted">{t('users.subtitle')}</p>
      </div>

      <div className="tile mx-4 flex items-center gap-2 rounded-full px-4 py-2.5">
        <Icon name="search" size={16} className="shrink-0 text-faint" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('users.search')}
          className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-faint"
        />
      </div>

      <div className="no-scrollbar flex gap-2 overflow-x-auto px-4">
        <button
          type="button"
          onClick={() => {
            triggerHaptic('light')
            setBlockedOnly(false)
          }}
          className={`chip shrink-0 rounded-full px-3.5 py-2 text-[13px] font-semibold ${blockedOnly ? 'text-faint' : 'text-ink'}`}
        >
          {t('common.all')}
        </button>
        <button
          type="button"
          onClick={() => {
            triggerHaptic('light')
            setBlockedOnly(true)
          }}
          className={`chip shrink-0 rounded-full px-3.5 py-2 text-[13px] font-semibold ${blockedOnly ? 'text-ink' : 'text-faint'}`}
        >
          {t('users.filter.blocked')}
        </button>
      </div>

      <QueryGate
        data={usersQuery.data}
        isLoading={usersQuery.isPending}
        error={usersQuery.error}
        onRetry={() => void usersQuery.refetch()}
        skeleton={<ListSkeleton />}
      >
        {(data) => {
          const users = data.pages.flatMap((page) => page.users)
          if (users.length === 0) {
            return <EmptyState icon="users" title={t('users.empty')} />
          }
          return (
            <>
              <div className="panel mx-4 flex flex-col divide-y divide-line rounded-card">
                {users.map((user) => {
                  const name = user.username ? `@${user.username}` : user.firstName ?? user.tgId
                  return (
                    <Link key={user.id} href={`/users/${user.id}`} className="flex items-center justify-between gap-3 p-3">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-ink">
                          <span className="truncate">{name}</span>
                          {user.isAdmin ? (
                            <span className="shrink-0 rounded-full bg-cta/15 px-2 py-0.5 text-[10px] font-medium text-ink">
                              {t('user.admin')}
                            </span>
                          ) : null}
                          {user.isBlocked ? (
                            <span className="shrink-0 rounded-full bg-danger/15 px-2 py-0.5 text-[10px] font-medium text-danger">
                              {t('user.blocked')}
                            </span>
                          ) : null}
                        </p>
                        <p className="tnum truncate text-xs text-muted">
                          {user.tgId} · {t('users.orders', { count: user.ordersCount })} ·{' '}
                          {t('users.refs', { count: user.referralsCount })}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-xs text-faint">{formatDate(user.createdAt, locale)}</span>
                        <Icon name="chevron-right" size={16} className="text-faint" />
                      </div>
                    </Link>
                  )
                })}
              </div>
              {usersQuery.hasNextPage ? (
                <button
                  type="button"
                  disabled={usersQuery.isFetchingNextPage}
                  onClick={() => {
                    triggerHaptic('light')
                    void usersQuery.fetchNextPage()
                  }}
                  className="btn-ghost mx-4 rounded-full px-4 py-3 text-sm font-semibold text-ink disabled:opacity-60"
                >
                  {usersQuery.isFetchingNextPage ? t('common.loading') : t('common.loadMore')}
                </button>
              ) : null}
            </>
          )
        }}
      </QueryGate>
    </main>
  )
}
