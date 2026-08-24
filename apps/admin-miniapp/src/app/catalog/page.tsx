'use client'

import Link from 'next/link'
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
  type AdminCategory
} from '@/types/api'

function parseIntField(value: string): number {
  const num = Number(value)
  return Number.isInteger(num) && num >= 0 ? num : NaN
}

interface CategoryDraft {
  id: string | null
  title: string
  slug: string
  emoji: string
  sortOrder: string
  isActive: boolean
}

const emptyCategoryDraft: CategoryDraft = { id: null, title: '', slug: '', emoji: '', sortOrder: '0', isActive: true }

interface ProductDraft {
  categoryId: string
  title: string
  slug: string
  description: string
  imageUrl: string
  deliveryType: string
  sortOrder: string
  isActive: boolean
}

function CatalogSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-4 px-4 pt-2">
      <Skeleton className="h-12" />
      <Skeleton className="h-40" />
      <Skeleton className="h-40" />
    </div>
  )
}

export default function CatalogPage(): JSX.Element {
  const { t } = useI18n()
  const { isReady } = useTelegram()
  const queryClient = useQueryClient()

  const catalogQuery = useQuery({
    queryKey: ['admin', 'catalog'],
    queryFn: () => api.get('/api/admin/catalog', CatalogResponseSchema),
    enabled: isReady
  })

  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft | null>(null)
  const [productDraft, setProductDraft] = useState<ProductDraft | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  function invalidate(): void {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'catalog'] })
  }

  function onMutationError(error: unknown): void {
    triggerNotificationHaptic('error')
    setFormError(error instanceof ApiClientError ? error.message : t('common.error.generic'))
  }

  const saveCategory = useMutation({
    mutationFn: (draft: CategoryDraft) => {
      const body = {
        title: draft.title.trim(),
        slug: draft.slug.trim(),
        emoji: draft.emoji.trim() === '' ? null : draft.emoji.trim(),
        sortOrder: parseIntField(draft.sortOrder),
        isActive: draft.isActive
      }
      return draft.id
        ? api.patch(`/api/admin/categories/${draft.id}`, UpdatedResponseSchema, body)
        : api.post('/api/admin/categories', CreatedResponseSchema, body)
    },
    onSuccess: () => {
      triggerNotificationHaptic('success')
      setCategoryDraft(null)
      setFormError(null)
      invalidate()
    },
    onError: onMutationError
  })

  const deleteCategory = useMutation({
    mutationFn: (id: string) => api.del(`/api/admin/categories/${id}`, DeletedResponseSchema),
    onSuccess: () => {
      triggerNotificationHaptic('success')
      setCategoryDraft(null)
      setFormError(null)
      invalidate()
    },
    onError: onMutationError
  })

  const createProduct = useMutation({
    mutationFn: (draft: ProductDraft) =>
      api.post('/api/admin/products', CreatedResponseSchema, {
        categoryId: draft.categoryId,
        title: draft.title.trim(),
        slug: draft.slug.trim(),
        description: draft.description.trim(),
        imageUrl: draft.imageUrl.trim() === '' ? null : draft.imageUrl.trim(),
        deliveryType: draft.deliveryType,
        sortOrder: parseIntField(draft.sortOrder),
        isActive: draft.isActive
      }),
    onSuccess: () => {
      triggerNotificationHaptic('success')
      setProductDraft(null)
      setFormError(null)
      invalidate()
    },
    onError: onMutationError
  })

  function openCategorySheet(category: AdminCategory | null): void {
    triggerHaptic('light')
    setFormError(null)
    setCategoryDraft(
      category
        ? {
            id: category.id,
            title: category.title,
            slug: category.slug,
            emoji: category.emoji ?? '',
            sortOrder: String(category.sortOrder),
            isActive: category.isActive
          }
        : { ...emptyCategoryDraft }
    )
  }

  function openProductSheet(categories: AdminCategory[]): void {
    triggerHaptic('light')
    setFormError(null)
    setProductDraft({
      categoryId: categories[0]?.id ?? '',
      title: '',
      slug: '',
      description: '',
      imageUrl: '',
      deliveryType: DeliveryTypeSchema.options[0],
      sortOrder: '0',
      isActive: true
    })
  }

  const categoryFormValid =
    categoryDraft !== null &&
    categoryDraft.title.trim().length > 0 &&
    categoryDraft.slug.trim().length > 0 &&
    !Number.isNaN(parseIntField(categoryDraft.sortOrder))

  const productFormValid =
    productDraft !== null &&
    productDraft.categoryId !== '' &&
    productDraft.title.trim().length > 0 &&
    productDraft.slug.trim().length > 0 &&
    productDraft.description.trim().length > 0 &&
    !Number.isNaN(parseIntField(productDraft.sortOrder))

  return (
    <main className="page-enter flex flex-col gap-4 pt-2">
      <div className="mx-4 flex flex-col gap-1">
        <h1 className="text-xl font-bold tracking-[-0.02em] text-ink">{t('catalog.title')}</h1>
        <p className="text-sm text-muted">{t('catalog.subtitle')}</p>
      </div>

      <QueryGate
        data={catalogQuery.data}
        isLoading={catalogQuery.isPending}
        error={catalogQuery.error}
        onRetry={() => void catalogQuery.refetch()}
        skeleton={<CatalogSkeleton />}
      >
        {({ categories }) => (
          <>
            <div className="mx-4 flex gap-2">
              <button
                type="button"
                onClick={() => openCategorySheet(null)}
                className="btn-ghost flex flex-1 items-center justify-center gap-1.5 rounded-full px-4 py-3 text-sm font-semibold text-ink"
              >
                <Icon name="plus" size={15} />
                {t('catalog.addCategory')}
              </button>
              {categories.length > 0 ? (
                <button
                  type="button"
                  onClick={() => openProductSheet(categories)}
                  className="btn-primary flex flex-1 items-center justify-center gap-1.5 rounded-full px-4 py-3 text-sm font-bold text-cta-ink"
                >
                  <Icon name="plus" size={15} />
                  {t('catalog.addProduct')}
                </button>
              ) : null}
            </div>

            {categories.length === 0 ? (
              <EmptyState icon="grid" title={t('catalog.empty')} />
            ) : (
              categories.map((category) => (
                <section key={category.id} className="mx-4 flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => openCategorySheet(category)}
                    className="flex items-center justify-between gap-2 px-1"
                  >
                    <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-muted">
                      {category.emoji ? <span>{category.emoji}</span> : null}
                      <span className="truncate">{category.title}</span>
                      {!category.isActive ? (
                        <span className="rounded-full bg-line px-2 py-0.5 text-[10px] font-medium text-faint">
                          {t('catalog.hidden')}
                        </span>
                      ) : null}
                    </span>
                    <Icon name="settings" size={14} className="shrink-0 text-faint" />
                  </button>
                  {category.products.length === 0 ? (
                    <p className="panel rounded-card px-3 py-3 text-sm text-muted">{t('catalog.noProducts')}</p>
                  ) : (
                    <div className="panel flex flex-col divide-y divide-line rounded-card">
                      {category.products.map((product) => {
                        const minPrice = product.plans.length
                          ? Math.min(...product.plans.map((plan) => plan.priceCents))
                          : null
                        return (
                          <Link
                            key={product.id}
                            href={`/catalog/product/${product.id}`}
                            className="flex items-center justify-between gap-3 p-3"
                          >
                            <div className="min-w-0">
                              <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-ink">
                                {product.title}
                                {!product.isActive ? (
                                  <span className="rounded-full bg-line px-2 py-0.5 text-[10px] font-medium text-faint">
                                    {t('catalog.hidden')}
                                  </span>
                                ) : null}
                              </p>
                              <p className="truncate text-xs text-muted">
                                {t(`delivery.${product.deliveryType}`)} ·{' '}
                                {t('catalog.plans', { count: product.plans.length })}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              {minPrice !== null ? (
                                <span className="tnum text-sm font-bold text-ink">{formatCents(minPrice)}</span>
                              ) : null}
                              <Icon name="chevron-right" size={16} className="text-faint" />
                            </div>
                          </Link>
                        )
                      })}
                    </div>
                  )}
                </section>
              ))
            )}

            <BottomSheet
              isOpen={categoryDraft !== null}
              onClose={() => setCategoryDraft(null)}
              title={categoryDraft?.id ? t('category.sheet.edit') : t('category.sheet.create')}
            >
              {categoryDraft ? (
                <div className="flex flex-col gap-3">
                  <TextField
                    label={t('field.title')}
                    value={categoryDraft.title}
                    onChange={(title) => setCategoryDraft({ ...categoryDraft, title })}
                    maxLength={120}
                  />
                  <TextField
                    label={t('field.slug')}
                    value={categoryDraft.slug}
                    onChange={(slug) => setCategoryDraft({ ...categoryDraft, slug })}
                    maxLength={64}
                    placeholder="chatgpt"
                  />
                  <TextField
                    label={`${t('field.emoji')} (${t('field.optional')})`}
                    value={categoryDraft.emoji}
                    onChange={(emoji) => setCategoryDraft({ ...categoryDraft, emoji })}
                    maxLength={16}
                  />
                  <TextField
                    label={t('field.sortOrder')}
                    value={categoryDraft.sortOrder}
                    onChange={(sortOrder) => setCategoryDraft({ ...categoryDraft, sortOrder })}
                    inputMode="numeric"
                  />
                  <ToggleField
                    label={t('field.isActive')}
                    value={categoryDraft.isActive}
                    onChange={(isActive) => setCategoryDraft({ ...categoryDraft, isActive })}
                  />
                  <FormError message={formError} />
                  <button
                    type="button"
                    disabled={!categoryFormValid || saveCategory.isPending}
                    onClick={() => categoryDraft && saveCategory.mutate(categoryDraft)}
                    className="btn-primary w-full rounded-full px-4 py-3.5 text-sm font-bold text-cta-ink disabled:opacity-60"
                  >
                    {saveCategory.isPending ? t('common.loading') : categoryDraft.id ? t('common.save') : t('common.create')}
                  </button>
                  {categoryDraft.id ? (
                    <button
                      type="button"
                      disabled={deleteCategory.isPending}
                      onClick={() => {
                        if (categoryDraft.id && window.confirm(t('form.deleteConfirm'))) {
                          deleteCategory.mutate(categoryDraft.id)
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

            <BottomSheet
              isOpen={productDraft !== null}
              onClose={() => setProductDraft(null)}
              title={t('product.sheet.create')}
            >
              {productDraft ? (
                <div className="flex flex-col gap-3">
                  <SelectField
                    label={t('field.category')}
                    value={productDraft.categoryId}
                    onChange={(categoryId) => setProductDraft({ ...productDraft, categoryId })}
                    options={categories.map((category) => ({ value: category.id, label: category.title }))}
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
                    placeholder="chatgpt-plus"
                  />
                  <TextAreaField
                    label={t('field.description')}
                    value={productDraft.description}
                    onChange={(description) => setProductDraft({ ...productDraft, description })}
                    maxLength={4000}
                  />
                  <TextField
                    label={`${t('field.imageUrl')} (${t('field.optional')})`}
                    value={productDraft.imageUrl}
                    onChange={(imageUrl) => setProductDraft({ ...productDraft, imageUrl })}
                    inputMode="url"
                    placeholder="https://…"
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
                    disabled={!productFormValid || createProduct.isPending}
                    onClick={() => productDraft && createProduct.mutate(productDraft)}
                    className="btn-primary w-full rounded-full px-4 py-3.5 text-sm font-bold text-cta-ink disabled:opacity-60"
                  >
                    {createProduct.isPending ? t('common.loading') : t('common.create')}
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
