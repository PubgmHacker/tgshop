'use client'

import { useParams } from 'next/navigation'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/i18n/I18nProvider'
import { api, ApiClientError } from '@/lib/apiClient'
import { formatCents, formatDate } from '@/lib/format'
import { triggerHaptic, triggerNotificationHaptic, useTelegram } from '@/lib/TelegramProvider'
import { BottomSheet } from '@/components/BottomSheet'
import { CopyButton } from '@/components/CopyButton'
import { QueryGate } from '@/components/QueryGate'
import { SectionLabel } from '@/components/SectionLabel'
import { Skeleton } from '@/components/Skeletons'
import { StatusPill } from '@/components/StatusPill'
import {
  ManualDeliveryResponseSchema,
  OrderDetailResponseSchema,
  RefundResponseSchema
} from '@/types/api'

function InfoRow({ label, value }: { label: string; value: React.ReactNode }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
      <span className="text-[13px] text-muted">{label}</span>
      <span className="tnum min-w-0 truncate text-right text-[13px] font-semibold text-ink">
        {value}
      </span>
    </div>
  )
}

function DetailSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-4 px-4 pt-2">
      <Skeleton className="h-28" />
      <Skeleton className="h-64" />
      <Skeleton className="h-32" />
    </div>
  )
}

export default function OrderDetailPage(): JSX.Element {
  const params = useParams<{ id: string }>()
  const orderId = params.id
  const { t, locale } = useI18n()
  const { isReady } = useTelegram()
  const queryClient = useQueryClient()

  const [refundOpen, setRefundOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [refundError, setRefundError] = useState<string | null>(null)
  const [manualOpen, setManualOpen] = useState(false)
  const [manualPayload, setManualPayload] = useState('')
  const [manualError, setManualError] = useState<string | null>(null)
  const [manualNotice, setManualNotice] = useState<string | null>(null)

  const detailQuery = useQuery({
    queryKey: ['admin', 'order', orderId],
    queryFn: () => api.get(`/api/admin/orders/${orderId}`, OrderDetailResponseSchema),
    enabled: isReady && Boolean(orderId)
  })

  const refundMutation = useMutation({
    mutationFn: (body: { reason: string }) =>
      api.post(`/api/admin/orders/${orderId}/refund`, RefundResponseSchema, body),
    onSuccess: () => {
      triggerNotificationHaptic('success')
      setRefundOpen(false)
      setReason('')
      setRefundError(null)
      void queryClient.invalidateQueries({ queryKey: ['admin', 'order', orderId] })
      void queryClient.invalidateQueries({ queryKey: ['admin', 'orders'] })
      void queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] })
    },
    onError: (error) => {
      triggerNotificationHaptic('error')
      setRefundError(error instanceof ApiClientError ? error.message : t('common.error.generic'))
    }
  })

  const manualMutation = useMutation({
    mutationFn: (payload: string) =>
      api.post(`/api/admin/orders/${orderId}/manual-deliver`, ManualDeliveryResponseSchema, {
        payload
      }),
    onSuccess: (result) => {
      triggerNotificationHaptic('success')
      setManualOpen(false)
      setManualPayload('')
      setManualError(null)
      setManualNotice(result.buyerNotified ? t('manual.notified') : t('manual.notNotified'))
      void queryClient.invalidateQueries({ queryKey: ['admin', 'order', orderId] })
      void queryClient.invalidateQueries({ queryKey: ['admin', 'orders'] })
      void queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] })
    },
    onError: (error) => {
      triggerNotificationHaptic('error')
      setManualError(error instanceof ApiClientError ? error.message : t('common.error.generic'))
    }
  })

  return (
    <main className="page-enter flex flex-col gap-4 pt-2">
      <QueryGate
        data={detailQuery.data}
        isLoading={detailQuery.isPending}
        error={detailQuery.error}
        onRetry={() => void detailQuery.refetch()}
        skeleton={<DetailSkeleton />}
      >
        {({ order, payments, ledger }) => {
          const buyer = order.user.username
            ? `@${order.user.username}`
            : (order.user.firstName ?? order.user.tgId)
          const refundable = order.status !== 'REFUNDED' && order.refundedCents === 0
          const manuallyDeliverable =
            order.deliveryType === 'MANUAL_FALLBACK' &&
            (order.status === 'PAID' || order.status === 'DELIVERING') &&
            !order.isDelivered
          return (
            <>
              <section className="relative mx-4 overflow-hidden rounded-[22px]">
                <div className="glass relative rounded-[22px] p-4">
                  <div className="glass-sheen" aria-hidden />
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-faint">
                        {t('order.title')} · {order.id.slice(0, 8)}
                      </p>
                      <p className="mt-1 truncate text-lg font-bold tracking-[-0.02em] text-ink">
                        {order.productTitle}
                      </p>
                      <p className="truncate text-sm text-muted">{order.planTitle}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <span className="tnum text-lg font-bold text-ink">
                        {formatCents(order.amountCents)}
                      </span>
                      <StatusPill status={order.status} />
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2 rounded-tile bg-card-strong px-3 py-2">
                    <span className="truncate text-[13px] text-muted">
                      {t('order.buyer')}: <span className="font-semibold text-ink">{buyer}</span>
                    </span>
                    <CopyButton value={order.user.tgId} label={order.user.tgId} />
                  </div>
                </div>
              </section>

              <section className="mx-4 flex flex-col gap-2.5">
                <div className="panel flex flex-col divide-y divide-line rounded-card">
                  <InfoRow label={t('order.qty')} value={order.qty} />
                  <InfoRow label={t('promo.code')} value={order.promoCode ?? '—'} />
                  <InfoRow label={t('order.created')} value={formatDate(order.createdAt, locale)} />
                  <InfoRow
                    label={t('order.paid')}
                    value={order.paidAt ? formatDate(order.paidAt, locale) : '—'}
                  />
                  <InfoRow
                    label={t('order.delivered')}
                    value={order.deliveredAt ? formatDate(order.deliveredAt, locale) : '—'}
                  />
                  <InfoRow
                    label={t('order.expires')}
                    value={order.expiresAt ? formatDate(order.expiresAt, locale) : '—'}
                  />
                  {order.refundedCents > 0 ? (
                    <InfoRow label={t('order.refunded')} value={formatCents(order.refundedCents)} />
                  ) : null}
                </div>
              </section>

              <section className="mx-4 flex flex-col gap-2.5">
                <SectionLabel>{t('order.payments')}</SectionLabel>
                {payments.length === 0 ? (
                  <p className="px-1 text-sm text-muted">{t('order.payments.empty')}</p>
                ) : (
                  <div className="panel flex flex-col divide-y divide-line rounded-card">
                    {payments.map((payment) => (
                      <div key={payment.id} className="flex items-center justify-between gap-3 p-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-ink">
                            {t(`provider.${payment.provider}`)}
                          </p>
                          <p className="truncate text-xs text-muted">
                            {payment.amount}
                            {payment.asset ? ` ${payment.asset}` : ''} ·{' '}
                            {formatDate(payment.createdAt, locale)}
                          </p>
                          {payment.txHash ? (
                            <p className="tnum truncate text-[11px] text-faint">{payment.txHash}</p>
                          ) : null}
                        </div>
                        <span className="shrink-0 rounded-full bg-line px-2.5 py-1 text-[11px] font-medium text-muted">
                          {t(`payment.status.${payment.status}`)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="mx-4 flex flex-col gap-2.5">
                <SectionLabel>{t('order.ledger')}</SectionLabel>
                {ledger.length === 0 ? (
                  <p className="px-1 text-sm text-muted">{t('order.ledger.empty')}</p>
                ) : (
                  <div className="panel flex flex-col divide-y divide-line rounded-card">
                    {ledger.map((entry) => (
                      <div key={entry.id} className="flex items-center justify-between gap-3 p-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-ink">
                            {t(`ledger.${entry.type}`)}
                          </p>
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

              {manualNotice ? (
                <p
                  role="status"
                  className="mx-4 rounded-card bg-success/15 px-4 py-3 text-sm text-success"
                >
                  {manualNotice}
                </p>
              ) : null}

              {manuallyDeliverable ? (
                <div className="mx-4">
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic('medium')
                      setManualError(null)
                      setManualOpen(true)
                    }}
                    className="btn-primary w-full rounded-full px-4 py-3.5 text-sm font-bold text-cta-ink"
                  >
                    {t('manual.action')}
                  </button>
                </div>
              ) : null}

              {refundable ? (
                <div className="mx-4">
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic('medium')
                      setRefundOpen(true)
                    }}
                    className="w-full rounded-full bg-danger/15 px-4 py-3.5 text-sm font-bold text-danger active:opacity-80"
                  >
                    {t('refund.action')}
                  </button>
                </div>
              ) : (
                <p className="mx-4 rounded-card bg-card px-4 py-3 text-center text-sm text-muted">
                  {t('refund.already')}
                </p>
              )}

              <BottomSheet
                isOpen={manualOpen}
                onClose={() => setManualOpen(false)}
                title={t('manual.title')}
              >
                <div className="flex flex-col gap-3">
                  <p className="text-sm leading-relaxed text-muted">{t('manual.hint')}</p>
                  {order.customerEmail ? (
                    <p className="rounded-tile bg-card-strong px-3 py-2 text-xs text-muted">
                      {order.customerEmail}
                    </p>
                  ) : null}
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[13px] font-medium text-muted">
                      {t('manual.payload')}
                    </span>
                    <textarea
                      value={manualPayload}
                      onChange={(event) => {
                        setManualPayload(event.target.value)
                        setManualError(null)
                      }}
                      placeholder={t('manual.placeholder')}
                      rows={5}
                      maxLength={10_000}
                      className="tile w-full resize-none rounded-tile px-3.5 py-3 font-mono text-[13px] text-ink outline-none placeholder:font-sans placeholder:text-faint"
                    />
                  </label>
                  {manualError ? (
                    <p role="alert" className="text-sm text-danger">
                      {manualError}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    disabled={manualPayload.trim().length === 0 || manualMutation.isPending}
                    onClick={() => {
                      if (!window.confirm(t('manual.confirm'))) return
                      manualMutation.mutate(manualPayload.trim())
                    }}
                    className="btn-primary w-full rounded-full px-4 py-3.5 text-sm font-bold text-cta-ink disabled:opacity-60"
                  >
                    {manualMutation.isPending ? t('common.loading') : t('manual.submit')}
                  </button>
                </div>
              </BottomSheet>

              <BottomSheet
                isOpen={refundOpen}
                onClose={() => setRefundOpen(false)}
                title={t('refund.title')}
              >
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-muted">{t('refund.hint')}</p>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[13px] font-medium text-muted">{t('refund.reason')}</span>
                    <textarea
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder={t('refund.reason.placeholder')}
                      rows={3}
                      maxLength={500}
                      className="tile w-full resize-none rounded-tile px-3.5 py-3 text-sm text-ink outline-none placeholder:text-faint"
                    />
                  </label>
                  {refundError ? <p className="text-sm text-danger">{refundError}</p> : null}
                  <button
                    type="button"
                    disabled={reason.trim().length === 0 || refundMutation.isPending}
                    onClick={() => refundMutation.mutate({ reason: reason.trim() })}
                    className="btn-primary w-full rounded-full px-4 py-3.5 text-sm font-bold text-cta-ink disabled:opacity-60"
                  >
                    {refundMutation.isPending
                      ? t('common.loading')
                      : t('refund.submit', { amount: formatCents(order.amountCents) })}
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
