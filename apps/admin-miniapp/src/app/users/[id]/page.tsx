'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/i18n/I18nProvider'
import { api, ApiClientError } from '@/lib/apiClient'
import { formatCents, formatDate } from '@/lib/format'
import { triggerHaptic, triggerNotificationHaptic, useTelegram } from '@/lib/TelegramProvider'
import { BottomSheet } from '@/components/BottomSheet'
import { CopyButton } from '@/components/CopyButton'
import { FormError, TextField } from '@/components/Form'
import { Icon } from '@/components/Icons'
import { QueryGate } from '@/components/QueryGate'
import { SectionLabel } from '@/components/SectionLabel'
import { Skeleton } from '@/components/Skeletons'
import { StatusPill } from '@/components/StatusPill'
import { BalanceAdjustResponseSchema, BlockResponseSchema, UserDetailResponseSchema } from '@/types/api'

function DetailSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-4 px-4 pt-2">
      <Skeleton className="h-36" />
      <Skeleton className="h-24" />
      <Skeleton className="h-48" />
    </div>
  )
}

export default function UserDetailPage(): JSX.Element {
  const params = useParams<{ id: string }>()
  const userId = params.id
  const { t, locale } = useI18n()
  const { isReady } = useTelegram()
  const queryClient = useQueryClient()

  const [adjustOpen, setAdjustOpen] = useState(false)
  const [sign, setSign] = useState<1 | -1>(1)
  const [amount, setAmount] = useState('')
  const [comment, setComment] = useState('')
  const [idempotencyKey, setIdempotencyKey] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const detailQuery = useQuery({
    queryKey: ['admin', 'user', userId],
    queryFn: () => api.get(`/api/admin/users/${userId}`, UserDetailResponseSchema),
    enabled: isReady && Boolean(userId)
  })

  function invalidate(): void {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'user', userId] })
    void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
    void queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] })
  }

  const adjustMutation = useMutation({
    mutationFn: (body: { amountCents: number; comment: string; idempotencyKey: string }) =>
      api.post(`/api/admin/users/${userId}/balance`, BalanceAdjustResponseSchema, body),
    onSuccess: () => {
      triggerNotificationHaptic('success')
      setAdjustOpen(false)
      setAmount('')
      setComment('')
      setFormError(null)
      invalidate()
    },
    onError: (error) => {
      triggerNotificationHaptic('error')
      setFormError(error instanceof ApiClientError ? error.message : t('common.error.generic'))
    }
  })

  const blockMutation = useMutation({
    mutationFn: (blocked: boolean) => api.post(`/api/admin/users/${userId}/block`, BlockResponseSchema, { blocked }),
    onSuccess: () => {
      triggerNotificationHaptic('success')
      invalidate()
    },
    onError: () => triggerNotificationHaptic('error')
  })

  const amountValue = Number(amount)
  const amountValid = Number.isInteger(amountValue) && amountValue > 0 && amountValue <= 100_000_000
  const adjustValid = amountValid && comment.trim().length > 0

  return (
    <main className="page-enter flex flex-col gap-4 pt-2">
      <QueryGate
        data={detailQuery.data}
        isLoading={detailQuery.isPending}
        error={detailQuery.error}
        onRetry={() => void detailQuery.refetch()}
        skeleton={<DetailSkeleton />}
      >
        {({ user, balanceCents, totalSpentCents, totalToppedUpCents, orders, ledger }) => {
          const name = user.username ? `@${user.username}` : user.firstName ?? user.tgId
          return (
            <>
              <section className="relative mx-4 overflow-hidden rounded-[22px]">
                <div className="glass relative rounded-[22px] p-4">
                  <div className="glass-sheen" aria-hidden />
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-lg font-bold tracking-[-0.02em] text-ink">
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
                      <p className="text-sm text-muted">
                        {t('user.joined')}: {formatDate(user.createdAt, locale)}
                      </p>
                    </div>
                    <CopyButton value={user.tgId} label={user.tgId} />
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2.5">
                    {(
                      [
                        ['user.balance', balanceCents, 'text-ink'],
                        ['user.topped', totalToppedUpCents, 'text-success'],
                        ['user.spent', totalSpentCents, 'text-muted']
                      ] as const
                    ).map(([labelKey, cents, tone]) => (
                      <div key={labelKey} className="tile rounded-tile p-3 text-center">
                        <p className={`tnum text-[15px] font-bold ${tone}`}>{formatCents(cents)}</p>
                        <p className="mt-0.5 text-[11px] text-faint">{t(labelKey)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <div className="mx-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic('medium')
                    setFormError(null)
                    setSign(1)
                    setAmount('')
                    setComment('')
                    setIdempotencyKey(crypto.randomUUID())
                    setAdjustOpen(true)
                  }}
                  className="btn-primary flex flex-1 items-center justify-center gap-1.5 rounded-full px-4 py-3 text-sm font-bold text-cta-ink"
                >
                  <Icon name="wallet" size={15} />
                  {t('user.adjust')}
                </button>
                <button
                  type="button"
                  disabled={blockMutation.isPending}
                  onClick={() => {
                    triggerHaptic('medium')
                    if (user.isBlocked) {
                      blockMutation.mutate(false)
                      return
                    }
                    if (window.confirm(t('user.block.confirm'))) {
                      blockMutation.mutate(true)
                    }
                  }}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-4 py-3 text-sm font-bold disabled:opacity-60 ${
                    user.isBlocked ? 'btn-ghost text-ink' : 'bg-danger/15 text-danger'
                  }`}
                >
                  <Icon name="shield" size={15} />
                  {user.isBlocked ? t('user.unblock') : t('user.block')}
                </button>
              </div>

              <section className="mx-4 flex flex-col gap-2.5">
                <SectionLabel>{t('user.orders')}</SectionLabel>
                {orders.length === 0 ? (
                  <p className="px-1 text-sm text-muted">{t('user.orders.empty')}</p>
                ) : (
                  <div className="panel flex flex-col divide-y divide-line rounded-card">
                    {orders.map((order) => (
                      <Link
                        key={order.id}
                        href={`/orders/${order.id}`}
                        className="flex items-center justify-between gap-3 p-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-ink">
                            {order.productTitle} · {order.planTitle}
                          </p>
                          <p className="truncate text-xs text-muted">
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
                )}
              </section>

              <section className="mx-4 flex flex-col gap-2.5">
                <SectionLabel>{t('user.ledger')}</SectionLabel>
                {ledger.length === 0 ? (
                  <p className="px-1 text-sm text-muted">{t('user.ledger.empty')}</p>
                ) : (
                  <div className="panel flex flex-col divide-y divide-line rounded-card">
                    {ledger.map((entry) => (
                      <div key={entry.id} className="flex items-center justify-between gap-3 p-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-ink">{t(`ledger.${entry.type}`)}</p>
                          <p className="truncate text-xs text-muted">
                            {entry.comment ?? '—'} · {formatDate(entry.createdAt, locale)}
                          </p>
                        </div>
                        <span
                          className={`tnum shrink-0 text-sm font-bold ${entry.amountCents >= 0 ? 'text-success' : 'text-danger'}`}
                        >
                          {entry.amountCents >= 0 ? '+' : ''}
                          {formatCents(entry.amountCents)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <BottomSheet isOpen={adjustOpen} onClose={() => setAdjustOpen(false)} title={t('adjust.title')}>
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-muted">{t('adjust.hint')}</p>
                  <div className="flex gap-2">
                    {(
                      [
                        [1, '+', 'ledger.TOPUP'],
                        [-1, '−', 'ledger.PURCHASE']
                      ] as const
                    ).map(([value, symbol]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => {
                          triggerHaptic('light')
                          setSign(value)
                        }}
                        className={`chip flex-1 rounded-full px-3.5 py-2.5 text-sm font-bold ${
                          sign === value ? (value === 1 ? 'text-success' : 'text-danger') : 'text-faint'
                        }`}
                      >
                        {symbol}
                        {amountValid ? formatCents(amountValue) : '$0.00'}
                      </button>
                    ))}
                  </div>
                  <TextField
                    label={t('adjust.amount')}
                    value={amount}
                    onChange={setAmount}
                    inputMode="numeric"
                    placeholder="100"
                  />
                  <TextField
                    label={t('adjust.comment')}
                    value={comment}
                    onChange={setComment}
                    maxLength={200}
                    placeholder={t('adjust.comment.placeholder')}
                  />
                  <FormError message={formError} />
                  <button
                    type="button"
                    disabled={!adjustValid || adjustMutation.isPending}
                    onClick={() =>
                      adjustMutation.mutate({
                        amountCents: sign * amountValue,
                        comment: comment.trim(),
                        idempotencyKey
                      })
                    }
                    className="btn-primary w-full rounded-full px-4 py-3.5 text-sm font-bold text-cta-ink disabled:opacity-60"
                  >
                    {adjustMutation.isPending ? t('common.loading') : t('adjust.submit')}
                  </button>
                </div>
              </BottomSheet>
            </>
          )
        }}
      </QueryGate>
    </main>
  )
}
