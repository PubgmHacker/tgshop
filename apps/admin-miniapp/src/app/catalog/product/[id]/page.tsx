'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/i18n/I18nProvider'
import { api, ApiClientError } from '@/lib/apiClient'
import { formatCents } from '@/lib/format'
import { triggerHaptic, triggerNotificationHaptic, useTelegram } from '@/lib/TelegramProvider'
import { BottomSheet } from '@/components/BottomSheet'
import { FormError, SelectField, TextAreaField, TextField, ToggleField } from '@/components/Form'
import { Icon } from '@/components/Icons'
import { QueryGate } from '@/components/QueryGate'
import { Skeleton } from '@/components/Skeletons'
import { EmptyState } from '@/components/States'
import {
  CatalogResponseSchema,
  CreatedResponseSchema,
  DeletedResponseSchema,
  DeliveryTypeSchema,
  UpdatedResponseSchema,
  type AdminPlan
} from '@/types/api'

function toInt(value: string): number {
  const num = Number(value)
  return Number.isInteger(num) ? num : NaN
}

interface ProductDraft {
  categoryId: string
  title: string
  slug: string
  description: string
  imageUrl: string
  deliveryType: string
  externalConfig: string
  sortOrder: string
  isActive: boolean
}

interface PlanDraft {
  id: string | null
  title: string
  durationDays: string
  priceCents: string
  priceStars: string
  discountPercent: string
  lowStockThreshold: string
  sortOrder: string
  isActive: boolean
}

function DetailSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-4 px-4 pt-2">
      <Skeleton className="h-40" />
      <Skeleton className="h-64" />
    </div>
  )
}

export default function ProductDetailPage(): JSX.Element {
  const params = useParams<{ id: string }>()
  const productId = params.id
  const router = useRouter()
  const { t } = useI18n()
  const { isReady } = useTelegram()
  const queryClient = useQueryClient()

  const catalogQuery = useQuery({
    queryKey: ['admin', 'catalog'],
    queryFn: () => api.get('/api/admin/catalog', CatalogResponseSchema),
    enabled: isReady
  })

  const [productDraft, setProductDraft] = useState<ProductDraft | null>(null)
  const [planDraft, setPlanDraft] = useState<PlanDraft | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  function invalidate(): void {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'catalog'] })
  }

  function onMutationError(error: unknown): void {
    triggerNotificationHaptic('error')
    setFormError(error instanceof ApiClientError ? error.message : t('common.error.generic'))
  }

  const saveProduct = useMutation({
    mutationFn: (draft: ProductDraft) => {
      let externalConfig: Record<string, unknown> | null = null
      if (draft.externalConfig.trim() !== '') {
        externalConfig = JSON.parse(draft.externalConfig) as Record<string, unknown>
      }
      return api.patch(`/api/admin/products/${productId}`, UpdatedResponseSchema, {
        categoryId: draft.categoryId,
        title: draft.title.trim(),
        slug: draft.slug.trim(),
        description: draft.description.trim(),
        imageUrl: draft.imageUrl.trim() === '' ? null : draft.imageUrl.trim(),
        deliveryType: draft.deliveryType,
        externalConfig,
        sortOrder: toInt(draft.sortOrder),
        isActive: draft.isActive
      })
    },
    onSuccess: () => {
      triggerNotificationHaptic('success')
      setProductDraft(null)
      setFormError(null)
      invalidate()
    },
    onError: onMutationError
  })

  const deleteProduct = useMutation({
    mutationFn: () => api.del(`/api/admin/products/${productId}`, DeletedResponseSchema),
    onSuccess: () => {
      triggerNotificationHaptic('success')
      invalidate()
      router.back()
    },
    onError: onMutationError
  })

  const savePlan = useMutation({
    mutationFn: (draft: PlanDraft) => {
      const body = {
        title: draft.title.trim(),
        durationDays: draft.durationDays.trim() === '' ? null : toInt(draft.durationDays),
        priceCents: toInt(draft.priceCents),
        priceStars: draft.priceStars.trim() === '' ? null : toInt(draft.priceStars),
        discountPercent: toInt(draft.discountPercent),
        lowStockThreshold: toInt(draft.lowStockThreshold),
        sortOrder: toInt(draft.sortOrder),
        isActive: draft.isActive
      }
      return draft.id
        ? api.patch(`/api/admin/plans/${draft.id}`, UpdatedResponseSchema, body)
        : api.post('/api/admin/plans', CreatedResponseSchema, { ...body, productId })
    },
    onSuccess: () => {
      triggerNotificationHaptic('success')
      setPlanDraft(null)
      setFormError(null)
      invalidate()
    },
    onError: onMutationError
  })

  const deletePlan = useMutation({
    mutationFn: (id: string) => api.del(`/api/admin/plans/${id}`, DeletedResponseSchema),
    onSuccess: () => {
      triggerNotificationHaptic('success')
      setPlanDraft(null)
      setFormError(null)
      invalidate()
    },
    onError: onMutationError
  })

  function openPlanSheet(plan: AdminPlan | null): void {
    triggerHaptic('light')
    setFormError(null)
    setPlanDraft(
      plan
        ? {
            id: plan.id,
            title: plan.title,
            durationDays: plan.durationDays === null ? '' : String(plan.durationDays),
            priceCents: String(plan.priceCents),
            priceStars: plan.priceStars === null ? '' : String(plan.priceStars),
            discountPercent: String(plan.discountPercent),
            lowStockThreshold: String(plan.lowStockThreshold),
            sortOrder: String(plan.sortOrder),
            isActive: plan.isActive
          }
        : {
            id: null,
            title: '',
            durationDays: '30',
            priceCents: '',
            priceStars: '',
            discountPercent: '0',
            lowStockThreshold: '3',
            sortOrder: '0',
            isActive: true
          }
    )
  }

  const planFormValid =
    planDraft !== null &&
    planDraft.title.trim().length > 0 &&
    !Number.isNaN(toInt(planDraft.priceCents)) &&
    toInt(planDraft.priceCents) >= 1 &&
    (planDraft.durationDays.trim() === '' || toInt(planDraft.durationDays) >= 1) &&
    (planDraft.priceStars.trim() === '' || toInt(planDraft.priceStars) >= 1) &&
    !Number.isNaN(toInt(planDraft.discountPercent)) &&
    !Number.isNaN(toInt(planDraft.lowStockThreshold)) &&
    !Number.isNaN(toInt(planDraft.sortOrder))

  return (
    <main className="page-enter flex flex-col gap-4 pt-2">
      <QueryGate
        data={catalogQuery.data}
        isLoading={catalogQuery.isPending}
        error={catalogQuery.error}
        onRetry={() => void catalogQuery.refetch()}
        skeleton={<DetailSkeleton />}
      >
        {({ categories }) => {
          const product = categories.flatMap((category) => category.products).find((item) => item.id === productId)
          if (!product) {
            return <EmptyState icon="search" title={t('common.notFound')} />
          }
          const category = categories.find((item) => item.products.some((p) => p.id === productId))
          return (
            <>
              <section className="relative mx-4 overflow-hidden rounded-[22px]">
                <div className="glass relative rounded-[22px] p-4">
                  <div className="glass-sheen" aria-hidden />
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-faint">
                        {category?.emoji ? `${category.emoji} ` : ''}
                        {category?.title ?? ''}
                      </p>
                      <p className="mt-1 flex items-center gap-2 text-lg font-bold tracking-[-0.02em] text-ink">
                        <span className="truncate">{product.title}</span>
                        {!product.isActive ? (
                          <span className="shrink-0 rounded-full bg-line px-2 py-0.5 text-[10px] font-medium text-faint">
                            {t('catalog.hidden')}
                          </span>
                        ) : null}
                      </p>
                      <p className="text-sm text-muted">{t(`delivery.${product.deliveryType}`)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic('light')
                        setFormError(null)
                        setProductDraft({
                          categoryId: category?.id ?? '',
                          title: product.title,
                          slug: product.slug,
                          description: product.description,
                          imageUrl: product.imageUrl ?? '',
                          deliveryType: product.deliveryType,
                          externalConfig:
                            product.externalConfig == null ? '' : JSON.stringify(product.externalConfig, null, 2),
                          sortOrder: String(product.sortOrder),
                          isActive: product.isActive
                        })
                      }}
                      className="tile flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted"
                      aria-label={t('product.sheet.edit')}
                    >
                      <Icon name="settings" size={17} />
                    </button>
                  </div>
                  <p className="mt-3 whitespace-pre-line text-[13px] leading-relaxed text-muted">
                    {product.description}
                  </p>
                </div>
              </section>

              <section className="mx-4 flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-[13px] font-medium text-muted">{t('product.plans')}</p>
                  <button
                    type="button"
                    onClick={() => openPlanSheet(null)}
                    className="chip flex items-center gap-1 rounded-full px-3 py-1.5 text-[12px] font-semibold text-ink"
                  >
                    <Icon name="plus" size={13} />
                    {t('common.add')}
                  </button>
                </div>
                {product.plans.length === 0 ? (
                  <p className="panel rounded-card px-3 py-3 text-sm text-muted">{t('product.plans.empty')}</p>
                ) : (
                  <div className="panel flex flex-col divide-y divide-line rounded-card">
                    {product.plans.map((plan) => (
                      <div key={plan.id} className="flex flex-col gap-2 p-3">
                        <button
                          type="button"
                          onClick={() => openPlanSheet(plan)}
                          className="flex items-center justify-between gap-3 text-left"
                        >
                          <div className="min-w-0">
                            <p className="flex items-center gap-2 truncate text-sm font-semibold text-ink">
                              {plan.title}
                              {!plan.isActive ? (
                                <span className="rounded-full bg-line px-2 py-0.5 text-[10px] font-medium text-faint">
                                  {t('catalog.hidden')}
                                </span>
                              ) : null}
                            </p>
                            <p className="truncate text-xs text-muted">
                              {plan.durationDays === null ? t('plan.lifetime') : t('plan.days', { days: plan.durationDays })}
                              {plan.discountPercent > 0 ? ` · −${plan.discountPercent}%` : ''}
                              {plan.priceStars !== null ? ` · ⭐ ${plan.priceStars}` : ''}
                            </p>
                          </div>
                          <span className="tnum shrink-0 text-sm font-bold text-ink">{formatCents(plan.priceCents)}</span>
                        </button>
                        {(product.usesStock ?? (product.deliveryType === 'STOCK_POOL' || product.deliveryType === 'UNIQUE_CODE')) ? <Link
                          href={`/catalog/stock/${plan.id}`}
                          className="tile flex items-center justify-between rounded-tile px-3 py-2"
                        >
                          <span className="flex items-center gap-1.5 text-[12px] font-medium text-muted">
                            <Icon name="box" size={14} />
                            {t('plan.stock')}
                          </span>
                          <span
                            className={`tnum text-[12px] font-semibold ${
                              plan.stock.available <= plan.lowStockThreshold ? 'text-warning' : 'text-ink'
                            }`}
                          >
                            {plan.stock.available} · {plan.stock.reserved} · {plan.stock.sold}
                          </span>
                        </Link> : <p className="text-xs text-muted">{t('plan.stockNotUsed')}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <BottomSheet
                isOpen={productDraft !== null}
                onClose={() => setProductDraft(null)}
                title={t('product.sheet.edit')}
              >
                {productDraft ? (
                  <div className="flex flex-col gap-3">
                    <SelectField
                      label={t('field.category')}
                      value={productDraft.categoryId}
                      onChange={(categoryId) => setProductDraft({ ...productDraft, categoryId })}
                      options={categories.map((item) => ({ value: item.id, label: item.title }))}
                    />
                    <TextField
                      label={t('field.title')}
                      value={productDraft.title}
                      onChange={(title) => setProductDraft({ ...productDraft, title })}
                      maxLength={160}
                    />
                    <TextField
                      label={t('field.slug')}
                      value={productDraft.slug}
                      onChange={(slug) => setProductDraft({ ...productDraft, slug })}
                      maxLength={64}
                    />
                    <TextAreaField
                      label={t('field.description')}
                      value={productDraft.description}
                      onChange={(description) => setProductDraft({ ...productDraft, description })}
                      maxLength={4000}
                      rows={4}
                    />
                    <TextField
                      label={`${t('field.imageUrl')} (${t('field.optional')})`}
                      value={productDraft.imageUrl}
                      onChange={(imageUrl) => setProductDraft({ ...productDraft, imageUrl })}
                      inputMode="url"
                    />
                    <SelectField
                      label={t('field.deliveryType')}
                      value={productDraft.deliveryType}
                      onChange={(deliveryType) => setProductDraft({ ...productDraft, deliveryType })}
                      options={DeliveryTypeSchema.options.map((option) => ({
                        value: option,
                        label: t(`delivery.${option}`)
                      }))}
                    />
                    {productDraft.deliveryType === 'EXTERNAL_API' || productDraft.externalConfig.trim() !== '' ? (
                      <TextAreaField
                        label={`externalConfig · JSON (${t('field.optional')})`}
                        value={productDraft.externalConfig}
                        onChange={(externalConfig) => setProductDraft({ ...productDraft, externalConfig })}
                        rows={4}
                        placeholder='{ "endpoint": "https://…" }'
                      />
                    ) : null}
                    <TextField
                      label={t('field.sortOrder')}
                      value={productDraft.sortOrder}
                      onChange={(sortOrder) => setProductDraft({ ...productDraft, sortOrder })}
                      inputMode="numeric"
                    />
                    <ToggleField
                      label={t('field.isActive')}
                      value={productDraft.isActive}
                      onChange={(isActive) => setProductDraft({ ...productDraft, isActive })}
                    />
                    <FormError message={formError} />
                    <button
                      type="button"
                      disabled={saveProduct.isPending}
                      onClick={() => {
                        if (!productDraft) return
                        if (productDraft.externalConfig.trim() !== '') {
                          try {
                            JSON.parse(productDraft.externalConfig)
                          } catch {
                            setFormError('externalConfig: invalid JSON')
                            return
                          }
                        }
                        saveProduct.mutate(productDraft)
                      }}
                      className="btn-primary w-full rounded-full px-4 py-3.5 text-sm font-bold text-cta-ink disabled:opacity-60"
                    >
                      {saveProduct.isPending ? t('common.loading') : t('common.save')}
                    </button>
                    <button
                      type="button"
                      disabled={deleteProduct.isPending}
                      onClick={() => {
                        if (window.confirm(t('form.deleteConfirm'))) {
                          deleteProduct.mutate()
                        }
                      }}
                      className="w-full rounded-full bg-danger/15 px-4 py-3 text-sm font-bold text-danger disabled:opacity-60"
                    >
                      {t('common.delete')}
                    </button>
                  </div>
                ) : null}
              </BottomSheet>

              <BottomSheet
                isOpen={planDraft !== null}
                onClose={() => setPlanDraft(null)}
                title={planDraft?.id ? t('plan.sheet.edit') : t('plan.sheet.create')}
              >
                {planDraft ? (
                  <div className="flex flex-col gap-3">
                    <TextField
                      label={t('field.title')}
                      value={planDraft.title}
                      onChange={(title) => setPlanDraft({ ...planDraft, title })}
                      maxLength={160}
                    />
                    <TextField
                      label={t('field.durationDays')}
                      value={planDraft.durationDays}
                      onChange={(durationDays) => setPlanDraft({ ...planDraft, durationDays })}
                      inputMode="numeric"
                    />
                    <TextField
                      label={t('field.priceCents')}
                      value={planDraft.priceCents}
                      onChange={(priceCents) => setPlanDraft({ ...planDraft, priceCents })}
                      inputMode="numeric"
                      placeholder="1999"
                    />
                    <TextField
                      label={t('field.priceStars')}
                      value={planDraft.priceStars}
                      onChange={(priceStars) => setPlanDraft({ ...planDraft, priceStars })}
                      inputMode="numeric"
                    />
                    <TextField
                      label={t('field.discountPercent')}
                      value={planDraft.discountPercent}
                      onChange={(discountPercent) => setPlanDraft({ ...planDraft, discountPercent })}
                      inputMode="numeric"
                    />
                    <TextField
                      label={t('field.lowStockThreshold')}
                      value={planDraft.lowStockThreshold}
                      onChange={(lowStockThreshold) => setPlanDraft({ ...planDraft, lowStockThreshold })}
                      inputMode="numeric"
                    />
                    <TextField
                      label={t('field.sortOrder')}
                      value={planDraft.sortOrder}
                      onChange={(sortOrder) => setPlanDraft({ ...planDraft, sortOrder })}
                      inputMode="numeric"
                    />
                    <ToggleField
                      label={t('field.isActive')}
                      value={planDraft.isActive}
                      onChange={(isActive) => setPlanDraft({ ...planDraft, isActive })}
                    />
                    <FormError message={formError} />
                    <button
                      type="button"
                      disabled={!planFormValid || savePlan.isPending}
                      onClick={() => planDraft && savePlan.mutate(planDraft)}
                      className="btn-primary w-full rounded-full px-4 py-3.5 text-sm font-bold text-cta-ink disabled:opacity-60"
                    >
                      {savePlan.isPending ? t('common.loading') : planDraft.id ? t('common.save') : t('common.create')}
                    </button>
                    {planDraft.id ? (
                      <button
                        type="button"
                        disabled={deletePlan.isPending}
                        onClick={() => {
                          if (planDraft.id && window.confirm(t('form.deleteConfirm'))) {
                            deletePlan.mutate(planDraft.id)
                          }
                        }}
                        className="w-full rounded-full bg-danger/15 px-4 py-3 text-sm font-bold text-danger disabled:opacity-60"
                      >
                        {t('common.delete')}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </BottomSheet>
            </>
          )
        }}
      </QueryGate>
    </main>
  )
}
