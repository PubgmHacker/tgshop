'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/i18n/I18nProvider'
import { api, ApiClientError } from '@/lib/apiClient'
import { formatCents, formatDate } from '@/lib/format'
import { triggerHaptic, triggerNotificationHaptic, useTelegram } from '@/lib/TelegramProvider'
import { BottomSheet } from '@/components/BottomSheet'
import { FormError, SelectField, TextField, ToggleField } from '@/components/Form'
import { Icon } from '@/components/Icons'
import { QueryGate } from '@/components/QueryGate'
import { Skeleton } from '@/components/Skeletons'
import { EmptyState } from '@/components/States'
import {
  CatalogResponseSchema,
  CreatedResponseSchema,
  PromoTypeSchema,
  PromoListResponseSchema,
  UpdatedResponseSchema,
  type AdminPromo,
  type PromoType
} from '@/types/api'

const CODE_RE = /^[A-Za-z0-9_-]{2,64}$/

interface PromoDraft {
  id: string | null
  code: string
  type: PromoType
  value: string
  maxUses: string
  expiresAt: string
  planId: string
  isActive: boolean
}

const emptyDraft: PromoDraft = {
  id: null,
  code: '',
  type: 'PERCENT',
  value: '',
  maxUses: '',
  expiresAt: '',
  planId: '',
  isActive: true
}

/** ISO from the API → value for <input type="datetime-local"> in the admin's local tz. */
function toLocalInput(iso: string): string {
  const date = new Date(iso)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function ListSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-4 px-4 pt-2">
      <Skeleton className="h-12" />
      <Skeleton className="h-56" />
    </div>
  )
}

export default function PromosPage(): JSX.Element {
  const { t, locale } = useI18n()
  const { isReady } = useTelegram()
  const queryClient = useQueryClient()

  const promosQuery = useQuery({
    queryKey: ['admin', 'promos'],
    queryFn: () => api.get('/api/admin/promos', PromoListResponseSchema),
    enabled: isReady
  })

  const catalogQuery = useQuery({
    queryKey: ['admin', 'catalog'],
    queryFn: () => api.get('/api/admin/catalog', CatalogResponseSchema),
    enabled: isReady
  })

  const [draft, setDraft] = useState<PromoDraft | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const planOptions = [
    { value: '', label: '—' },
    ...(catalogQuery.data?.categories.flatMap((category) =>
      category.products.flatMap((product) =>
        product.plans.map((plan) => ({ value: plan.id, label: `${product.title} · ${plan.title}` }))
      )
    ) ?? [])
  ]

  const savePromo = useMutation({
    mutationFn: (current: PromoDraft) => {
      const body = {
        code: current.code.trim(),
        type: current.type,
        value: Number(current.value),
        maxUses: current.maxUses.trim() === '' ? null : Number(current.maxUses),
        expiresAt: current.expiresAt === '' ? null : new Date(current.expiresAt).toISOString(),
        planId: current.planId === '' ? null : current.planId,
        isActive: current.isActive
      }
      return current.id
        ? api.patch(`/api/admin/promos/${current.id}`, UpdatedResponseSchema, body)
        : api.post('/api/admin/promos', CreatedResponseSchema, body)
    },
    onSuccess: () => {
      triggerNotificationHaptic('success')
      setDraft(null)
      setFormError(null)
      void queryClient.invalidateQueries({ queryKey: ['admin', 'promos'] })
    },
    onError: (error) => {
      triggerNotificationHaptic('error')
      setFormError(error instanceof ApiClientError ? error.message : t('common.error.generic'))
    }
  })

  function openSheet(promo: AdminPromo | null): void {
    triggerHaptic('light')
    setFormError(null)
    setDraft(
      promo
        ? {
            id: promo.id,
            code: promo.code,
            type: promo.type,
            value: String(promo.value),
            maxUses: promo.maxUses === null ? '' : String(promo.maxUses),
            expiresAt: promo.expiresAt === null ? '' : toLocalInput(promo.expiresAt),
            planId: promo.planId ?? '',
            isActive: promo.isActive
          }
        : { ...emptyDraft }
    )
  }

  const valueNum = draft ? Number(draft.value) : NaN
  const draftValid =
    draft !== null &&
    CODE_RE.test(draft.code.trim()) &&
    Number.isInteger(valueNum) &&
    valueNum >= 1 &&
    (draft.type !== 'PERCENT' || valueNum <= 100) &&
    (draft.maxUses.trim() === '' || (Number.isInteger(Number(draft.maxUses)) && Number(draft.maxUses) >= 1)) &&
    (draft.expiresAt === '' || !Number.isNaN(new Date(draft.expiresAt).getTime()))

  function promoOff(promo: AdminPromo): string {
    return promo.type === 'PERCENT'
      ? t('promo.off', { value: `${promo.value}%` })
      : t('promo.off', { value: formatCents(promo.value) })
  }

  return (
    <main className="page-enter flex flex-col gap-4 pt-2">
      <div className="mx-4 flex flex-col gap-1">
        <h1 className="text-xl font-bold tracking-[-0.02em] text-ink">{t('promos.title')}</h1>
      </div>

      <QueryGate
        data={promosQuery.data}
        isLoading={promosQuery.isPending}
        error={promosQuery.error}
        onRetry={() => void promosQuery.refetch()}
        skeleton={<ListSkeleton />}
      >
        {({ promos }) => (
          <>
            <div className="mx-4">
              <button
                type="button"
                onClick={() => openSheet(null)}
                className="btn-primary flex w-full items-center justify-center gap-1.5 rounded-full px-4 py-3 text-sm font-bold text-cta-ink"
              >
                <Icon name="plus" size={15} />
                {t('promos.add')}
              </button>
            </div>

            {promos.length === 0 ? (
              <EmptyState icon="star" title={t('promos.empty')} />
            ) : (
              <div className="panel mx-4 flex flex-col divide-y divide-line rounded-card">
                {promos.map((promo) => (
                  <button
                    key={promo.id}
                    type="button"
                    onClick={() => openSheet(promo)}
                    className="flex items-center justify-between gap-3 p-3 text-left"
                  >
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 truncate text-sm font-bold text-ink">
                        <span className="tnum truncate">{promo.code}</span>
                        {!promo.isActive ? (
                          <span className="shrink-0 rounded-full bg-line px-2 py-0.5 text-[10px] font-medium text-faint">
                            {t('catalog.hidden')}
                          </span>
                        ) : null}
                      </p>
                      <p className="truncate text-xs text-muted">
                        {t('promo.used', { count: promo.maxUses === null ? promo.usedCount : `${promo.usedCount}/${promo.maxUses}` })}
                        {promo.expiresAt ? ` · ${t('promo.expires', { date: formatDate(promo.expiresAt, locale) })}` : ''}
                        {promo.planTitle ? ` · ${promo.planTitle}` : ''}
                      </p>
                    </div>
                    <span className="tnum shrink-0 rounded-full bg-success/15 px-2.5 py-1 text-[12px] font-bold text-success">
                      {promoOff(promo)}
                    </span>
                  </button>
                ))}
              </div>
            )}

            <BottomSheet
              isOpen={draft !== null}
              onClose={() => setDraft(null)}
              title={draft?.id ? t('promo.sheet.edit') : t('promo.sheet.create')}
            >
              {draft ? (
                <div className="flex flex-col gap-3">
                  <TextField
                    label={t('promo.code')}
                    value={draft.code}
                    onChange={(code) => setDraft({ ...draft, code })}
                    maxLength={64}
                    placeholder="WELCOME10"
                  />
                  <SelectField
                    label={t('promo.type')}
                    value={draft.type}
                    onChange={(type) => setDraft({ ...draft, type: type as PromoType })}
                    options={PromoTypeSchema.options.map((option) => ({
                      value: option,
                      label: t(`promo.type.${option}`)
                    }))}
                  />
                  <TextField
                    label={`${t('promo.value')} — ${t(`promo.value.hint.${draft.type}`)}`}
                    value={draft.value}
                    onChange={(value) => setDraft({ ...draft, value })}
                    inputMode="numeric"
                    placeholder={draft.type === 'PERCENT' ? '10' : '200'}
                  />
                  <TextField
                    label={t('promo.maxUses')}
                    value={draft.maxUses}
                    onChange={(maxUses) => setDraft({ ...draft, maxUses })}
                    inputMode="numeric"
                  />
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[13px] font-medium text-muted">{t('promo.expiresAt')}</span>
                    <input
                      type="datetime-local"
                      value={draft.expiresAt}
                      onChange={(event) => setDraft({ ...draft, expiresAt: event.target.value })}
                      className="tile w-full rounded-tile px-3.5 py-3 text-sm text-ink outline-none"
                    />
                  </label>
                  <SelectField
                    label={t('promo.plan')}
                    value={draft.planId}
                    onChange={(planId) => setDraft({ ...draft, planId })}
                    options={planOptions}
                  />
                  <ToggleField
                    label={t('field.isActive')}
                    value={draft.isActive}
                    onChange={(isActive) => setDraft({ ...draft, isActive })}
                  />
                  <FormError message={formError} />
                  <button
                    type="button"
                    disabled={!draftValid || savePromo.isPending}
                    onClick={() => draft && savePromo.mutate(draft)}
                    className="btn-primary w-full rounded-full px-4 py-3.5 text-sm font-bold text-cta-ink disabled:opacity-60"
                  >
                    {savePromo.isPending ? t('common.loading') : draft.id ? t('common.save') : t('common.create')}
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
