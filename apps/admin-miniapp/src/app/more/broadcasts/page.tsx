'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/i18n/I18nProvider'
import { api, ApiClientError } from '@/lib/apiClient'
import { formatDate } from '@/lib/format'
import { triggerHaptic, triggerNotificationHaptic, useTelegram } from '@/lib/TelegramProvider'
import { BottomSheet } from '@/components/BottomSheet'
import { FormError, SelectField, TextAreaField, TextField } from '@/components/Form'
import { Icon } from '@/components/Icons'
import { QueryGate } from '@/components/QueryGate'
import { ListRowSkeleton } from '@/components/Skeletons'
import { EmptyState } from '@/components/States'
import {
  BroadcastListResponseSchema,
  BroadcastMutationResponseSchema,
  BroadcastDeleteResponseSchema,
  BroadcastSegmentSchema,
  type AdminBroadcast,
  type BroadcastSegment,
  type PostStatus
} from '@/types/api'
import type { DictionaryKey } from '@/i18n/dictionaries'

interface BroadcastDraft {
  id: string | null
  text: string
  mediaUrl: string
  segment: BroadcastSegment
  scheduledAt: string
}

const emptyDraft: BroadcastDraft = {
  id: null,
  text: '',
  mediaUrl: '',
  segment: 'all',
  scheduledAt: ''
}

const EDITABLE_STATUSES: PostStatus[] = ['DRAFT', 'SCHEDULED', 'QUEUED', 'FAILED', 'CANCELLED']

function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function fromLocalInput(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
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

function statusTone(status: PostStatus): string {
  if (status === 'SENT') return 'bg-success/15 text-success'
  if (status === 'FAILED' || status === 'CANCELLED') return 'bg-danger/15 text-danger'
  if (status === 'QUEUED' || status === 'SENDING') return 'bg-warning/15 text-warning'
  return 'bg-line text-muted'
}

export default function BroadcastsPage(): JSX.Element {
  const { t, locale } = useI18n()
  const { isReady } = useTelegram()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<BroadcastDraft | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const broadcastsQuery = useQuery({
    queryKey: ['admin', 'broadcasts'],
    queryFn: () => api.get('/api/admin/broadcasts', BroadcastListResponseSchema),
    enabled: isReady,
    refetchInterval: 15_000
  })

  const saveMutation = useMutation({
    mutationFn: async ({ current, queue }: { current: BroadcastDraft; queue: boolean }) => {
      const saved = current.id
        ? await api.patch(`/api/admin/broadcasts/${current.id}`, BroadcastMutationResponseSchema, {
            text: current.text.trim(),
            mediaUrl: current.mediaUrl.trim() || null,
            segment: current.segment,
            scheduledAt: fromLocalInput(current.scheduledAt)
          })
        : await api.post('/api/admin/broadcasts', BroadcastMutationResponseSchema, {
            text: current.text.trim(),
            mediaUrl: current.mediaUrl.trim() || null,
            segment: current.segment,
            scheduledAt: fromLocalInput(current.scheduledAt),
            queue
          })
      if (!queue || !current.id) return saved
      return api.post(`/api/admin/broadcasts/${saved.post.id}/send`, BroadcastMutationResponseSchema)
    },
    onSuccess: (_result, variables) => {
      triggerNotificationHaptic('success')
      setDraft(null)
      setFormError(null)
      setNotice(variables.queue ? t('broadcasts.queued') : t('broadcasts.saved'))
      void queryClient.invalidateQueries({ queryKey: ['admin', 'broadcasts'] })
    },
    onError: (error) => {
      triggerNotificationHaptic('error')
      setFormError(error instanceof ApiClientError ? error.message : t('common.error.generic'))
    }
  })

  const sendMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/admin/broadcasts/${id}/send`, BroadcastMutationResponseSchema),
    onSuccess: () => {
      triggerNotificationHaptic('success')
      setNotice(t('broadcasts.queued'))
      void queryClient.invalidateQueries({ queryKey: ['admin', 'broadcasts'] })
    },
    onError: (error) => {
      triggerNotificationHaptic('error')
      setNotice(error instanceof ApiClientError ? error.message : t('common.error.generic'))
    }
  })

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/admin/broadcasts/${id}/cancel`, BroadcastMutationResponseSchema),
    onSuccess: () => {
      triggerNotificationHaptic('success')
      setNotice(t('broadcasts.cancelled'))
      void queryClient.invalidateQueries({ queryKey: ['admin', 'broadcasts'] })
    },
    onError: (error) => {
      triggerNotificationHaptic('error')
      setNotice(error instanceof ApiClientError ? error.message : t('common.error.generic'))
    }
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.del(`/api/admin/broadcasts/${id}`, BroadcastDeleteResponseSchema),
    onSuccess: () => {
      triggerNotificationHaptic('success')
      setNotice(t('broadcasts.deleted'))
      void queryClient.invalidateQueries({ queryKey: ['admin', 'broadcasts'] })
    },
    onError: (error) => {
      triggerNotificationHaptic('error')
      setNotice(error instanceof ApiClientError ? error.message : t('common.error.generic'))
    }
  })

  const busy = saveMutation.isPending || sendMutation.isPending || cancelMutation.isPending || deleteMutation.isPending
  const segmentCounts = useMemo(
    () => new Map((broadcastsQuery.data?.segments ?? []).map((entry) => [entry.value, entry.count])),
    [broadcastsQuery.data?.segments]
  )

  function openCreate(): void {
    triggerHaptic('light')
    setNotice(null)
    setFormError(null)
    setDraft({ ...emptyDraft })
  }

  function openEdit(post: AdminBroadcast): void {
    triggerHaptic('light')
    setNotice(null)
    setFormError(null)
    setDraft({
      id: post.id,
      text: post.text,
      mediaUrl: post.mediaUrl ?? '',
      segment: post.segment ?? 'all',
      scheduledAt: toLocalInput(post.scheduledAt)
    })
  }

  function save(queue: boolean): void {
    if (!draft) return
    if (!draft.text.trim()) {
      setFormError(t('broadcasts.textRequired'))
      return
    }
    if (draft.scheduledAt && fromLocalInput(draft.scheduledAt) === null) {
      setFormError(t('broadcasts.invalidSchedule'))
      return
    }
    if (queue && draft.scheduledAt) {
      const scheduled = new Date(draft.scheduledAt).getTime()
      if (!Number.isFinite(scheduled) || scheduled <= Date.now()) {
        setFormError(t('broadcasts.scheduleRequired'))
        return
      }
    }
    if (queue && !window.confirm(t('broadcasts.confirmSend'))) return
    saveMutation.mutate({ current: draft, queue })
  }

  function statusLabel(status: PostStatus): string {
    return t(`broadcasts.status.${status}` as DictionaryKey)
  }

  function segmentLabel(segment: BroadcastSegment | null): string {
    return t(`broadcasts.segment.${segment ?? 'all'}` as DictionaryKey)
  }

  function postStats(post: AdminBroadcast): string | null {
    const stats = post.statsJson
    if (!stats) return null
    const sent = stats.sent ?? 0
    const total = stats.total ?? 0
    const failed = stats.failed ?? 0
    const blocked = stats.blocked ?? 0
    return `${sent}/${total}${failed || blocked ? ` · −${failed + blocked}` : ''}`
  }

  return (
    <main className="page-enter flex flex-col gap-4 pt-2">
      <div className="mx-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-xl font-bold tracking-[-0.02em] text-ink">{t('broadcasts.title')}</h1>
          <p className="text-sm text-muted">{t('broadcasts.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="btn-primary flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2.5 text-xs font-bold text-cta-ink"
        >
          <Icon name="plus" size={15} />
          {t('broadcasts.add')}
        </button>
      </div>

      {notice ? <p className="mx-4 rounded-tile bg-success/10 px-3.5 py-3 text-sm text-success">{notice}</p> : null}

      <QueryGate
        data={broadcastsQuery.data}
        isLoading={broadcastsQuery.isPending}
        error={broadcastsQuery.error}
        onRetry={() => void broadcastsQuery.refetch()}
        skeleton={<ListSkeleton />}
      >
        {({ posts }) => {
          if (posts.length === 0) {
            return <EmptyState icon="send" title={t('broadcasts.empty')} description={t('broadcasts.autoHint')} />
          }

          return (
            <div className="panel mx-4 flex flex-col divide-y divide-line rounded-card">
              {posts.map((post) => {
                const editable = EDITABLE_STATUSES.includes(post.status)
                const sendable = editable && post.status !== 'QUEUED'
                const stats = postStats(post)
                return (
                  <article key={post.id} className="flex flex-col gap-2.5 p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm font-semibold text-ink">
                          {post.text}
                        </p>
                        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                          <span>{segmentLabel(post.segment)}</span>
                          <span aria-hidden>·</span>
                          <span>{formatDate(post.createdAt, locale)}</span>
                          {post.scheduledAt ? (
                            <>
                              <span aria-hidden>·</span>
                              <span>{toLocalInput(post.scheduledAt).replace('T', ' ')}</span>
                            </>
                          ) : null}
                        </p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusTone(post.status)}`}>
                        {statusLabel(post.status)}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-faint">
                      <span className="rounded-full bg-line px-2 py-1">
                        {t('broadcasts.reach', { count: segmentCounts.get(post.segment ?? 'all') ?? 0 })}
                      </span>
                      {stats ? <span className="tnum rounded-full bg-line px-2 py-1">{stats}</span> : null}
                      {post.source === 'AGENT' ? (
                        <span className="rounded-full bg-warning/15 px-2 py-1 text-warning">{t('broadcasts.source.auto')}</span>
                      ) : null}
                    </div>

                    {post.mediaUrl ? <p className="truncate text-xs text-faint">{post.mediaUrl}</p> : null}

                    <div className="flex flex-wrap gap-2">
                      {editable ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => openEdit(post)}
                          className="btn-ghost rounded-full px-3 py-2 text-xs font-semibold text-ink disabled:opacity-50"
                        >
                          {t('broadcasts.edit')}
                        </button>
                      ) : null}
                      {sendable ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            if (window.confirm(t('broadcasts.confirmSend'))) sendMutation.mutate(post.id)
                          }}
                          className="btn-primary rounded-full px-3 py-2 text-xs font-bold text-cta-ink disabled:opacity-50"
                        >
                          {t('broadcasts.sendNow')}
                        </button>
                      ) : null}
                      {post.status === 'QUEUED' ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            if (window.confirm(t('broadcasts.confirmCancel'))) cancelMutation.mutate(post.id)
                          }}
                          className="btn-ghost rounded-full px-3 py-2 text-xs font-semibold text-warning disabled:opacity-50"
                        >
                          {t('broadcasts.cancel')}
                        </button>
                      ) : null}
                      {editable ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            if (window.confirm(t('broadcasts.confirmDelete'))) deleteMutation.mutate(post.id)
                          }}
                          className="rounded-full bg-danger/10 px-3 py-2 text-xs font-semibold text-danger disabled:opacity-50"
                        >
                          {t('broadcasts.delete')}
                        </button>
                      ) : null}
                    </div>
                  </article>
                )
              })}
            </div>
          )
        }}
      </QueryGate>

      <BottomSheet
        isOpen={draft !== null}
        onClose={() => {
          if (!saveMutation.isPending) setDraft(null)
        }}
        title={draft?.id ? t('broadcasts.edit') : t('broadcasts.add')}
      >
        {draft ? (
          <div className="flex flex-col gap-3">
            <TextAreaField
              label={t('broadcasts.text')}
              value={draft.text}
              onChange={(text) => setDraft({ ...draft, text })}
              placeholder={t('broadcasts.text.placeholder')}
              rows={7}
              maxLength={4096}
              hint={`${draft.text.length} / 4096`}
            />
            <TextField
              label={t('broadcasts.mediaUrl')}
              value={draft.mediaUrl}
              onChange={(mediaUrl) => setDraft({ ...draft, mediaUrl })}
              inputMode="url"
              placeholder="https://…"
            />
            <SelectField
              label={t('broadcasts.segment')}
              value={draft.segment}
              onChange={(segment) => setDraft({ ...draft, segment: BroadcastSegmentSchema.parse(segment) })}
              options={BroadcastSegmentSchema.options.map((segment) => ({
                value: segment,
                label: `${t(`broadcasts.segment.${segment}` as DictionaryKey)} · ${segmentCounts.get(segment) ?? 0}`
              }))}
            />
            <TextField
              label={t('broadcasts.schedule')}
              value={draft.scheduledAt}
              onChange={(scheduledAt) => setDraft({ ...draft, scheduledAt })}
              type="datetime-local"
            />
            <p className="-mt-1 text-xs leading-relaxed text-faint">{t('broadcasts.schedule.hint')}</p>
            <FormError message={formError} />
            <button
              type="button"
              disabled={busy}
              onClick={() => save(false)}
              className="btn-ghost w-full rounded-full px-4 py-3.5 text-sm font-semibold text-ink disabled:opacity-50"
            >
              {t('broadcasts.saveDraft')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => save(true)}
              className="btn-primary w-full rounded-full px-4 py-3.5 text-sm font-bold text-cta-ink disabled:opacity-50"
            >
              {t('broadcasts.sendNow')}
            </button>
          </div>
        ) : null}
      </BottomSheet>
    </main>
  )
}
