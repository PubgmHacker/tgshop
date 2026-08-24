'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { dictionaries, type DictionaryKey } from '@/i18n/dictionaries'
import { useI18n } from '@/i18n/I18nProvider'
import { api, ApiClientError } from '@/lib/apiClient'
import { formatCents } from '@/lib/format'
import { triggerHaptic, triggerNotificationHaptic, useTelegram } from '@/lib/TelegramProvider'
import { BottomSheet } from '@/components/BottomSheet'
import { FormError } from '@/components/Form'
import { Icon } from '@/components/Icons'
import { QueryGate } from '@/components/QueryGate'
import { Skeleton } from '@/components/Skeletons'
import { SettingsResponseSchema, SettingUpdateResponseSchema, type SettingItem, type SettingKind } from '@/types/api'

function labelFor(key: string, t: (key: DictionaryKey) => string): string {
  const dictKey = `setting.key.${key}`
  return dictKey in dictionaries.ru ? t(dictKey as DictionaryKey) : key
}

/** Row preview of the current value, per editor kind. */
function renderValue(kind: SettingKind, value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (kind === 'cents' && typeof value === 'number') return formatCents(value)
  if (kind === 'percent') return `${String(value)}%`
  if (kind === 'json') {
    const compact = JSON.stringify(value)
    return compact.length > 40 ? `${compact.slice(0, 40)}…` : compact
  }
  return String(value)
}

/** Editor seed: what goes into the input when the sheet opens. */
function toDraft(kind: SettingKind, value: unknown): string {
  if (value === null || value === undefined) return ''
  if (kind === 'json') return JSON.stringify(value, null, 2)
  return String(value)
}

function ListSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-4 px-4 pt-2">
      <Skeleton className="h-72" />
    </div>
  )
}

export default function SettingsPage(): JSX.Element {
  const { t } = useI18n()
  const { isReady } = useTelegram()
  const queryClient = useQueryClient()

  const settingsQuery = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => api.get('/api/admin/settings', SettingsResponseSchema),
    enabled: isReady
  })

  const [editing, setEditing] = useState<SettingItem | null>(null)
  const [draft, setDraft] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const saveMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) =>
      api.put(`/api/admin/settings/${key}`, SettingUpdateResponseSchema, { value }),
    onSuccess: () => {
      triggerNotificationHaptic('success')
      setEditing(null)
      setFormError(null)
      void queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] })
    },
    onError: (error) => {
      triggerNotificationHaptic('error')
      setFormError(error instanceof ApiClientError ? error.message : t('common.error.generic'))
    }
  })

  function submit(): void {
    if (!editing) return
    const raw = draft.trim()
    let value: unknown
    if (editing.kind === 'json') {
      try {
        value = raw === '' ? null : JSON.parse(raw)
      } catch {
        setFormError('JSON?')
        return
      }
    } else if (editing.kind === 'url') {
      value = raw
    } else {
      const num = Number(raw)
      if (raw === '' || Number.isNaN(num)) {
        setFormError(t('common.error.generic'))
        return
      }
      value = editing.kind === 'decimal' ? num : Math.trunc(num)
    }
    saveMutation.mutate({ key: editing.key, value })
  }

  return (
    <main className="page-enter flex flex-col gap-4 pt-2">
      <div className="mx-4 flex flex-col gap-1">
        <h1 className="text-xl font-bold tracking-[-0.02em] text-ink">{t('settings.title')}</h1>
        <p className="text-sm text-muted">{t('settings.hint')}</p>
      </div>

      <QueryGate
        data={settingsQuery.data}
        isLoading={settingsQuery.isPending}
        error={settingsQuery.error}
        onRetry={() => void settingsQuery.refetch()}
        skeleton={<ListSkeleton />}
      >
        {({ settings }) => (
          <>
            <div className="panel mx-4 flex flex-col divide-y divide-line rounded-card">
              {settings.map((setting) => (
                <button
                  key={setting.key}
                  type="button"
                  onClick={() => {
                    triggerHaptic('light')
                    setFormError(null)
                    setDraft(toDraft(setting.kind, setting.value))
                    setEditing(setting)
                  }}
                  className="flex items-center justify-between gap-3 p-3.5 text-left"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{labelFor(setting.key, t)}</p>
                    <p className="tnum truncate text-xs text-muted">{setting.key}</p>
                  </div>
                  <span className="tnum flex shrink-0 items-center gap-1.5 text-sm font-bold text-ink">
                    {renderValue(setting.kind, setting.value)}
                    <Icon name="chevron-right" size={15} className="text-faint" />
                  </span>
                </button>
              ))}
            </div>

            <BottomSheet
              isOpen={editing !== null}
              onClose={() => setEditing(null)}
              title={editing ? labelFor(editing.key, t) : ''}
            >
              {editing ? (
                <div className="flex flex-col gap-3">
                  <p className="tnum text-xs text-faint">{editing.key}</p>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[13px] font-medium text-muted">{t('setting.value')}</span>
                    {editing.kind === 'json' ? (
                      <textarea
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        rows={7}
                        className="tile w-full resize-none rounded-tile px-3.5 py-3 font-mono text-[13px] text-ink outline-none"
                      />
                    ) : (
                      <input
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        inputMode={editing.kind === 'url' ? 'url' : 'decimal'}
                        className="tile w-full rounded-tile px-3.5 py-3 text-sm text-ink outline-none"
                      />
                    )}
                  </label>
                  <FormError message={formError} />
                  <button
                    type="button"
                    disabled={saveMutation.isPending}
                    onClick={submit}
                    className="btn-primary w-full rounded-full px-4 py-3.5 text-sm font-bold text-cta-ink disabled:opacity-60"
                  >
                    {saveMutation.isPending ? t('common.loading') : t('common.save')}
                  </button>
                </div>
              ) : null}
            </BottomSheet>
          </>
        )}
      </QueryGate>
    </main>
  )
}
