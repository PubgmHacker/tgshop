'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { useTelegram } from '@/lib/TelegramProvider'
import {
  CatalogResponseSchema,
  CategoryResponseSchema,
  ConfigResponseSchema,
  CreateOrderResponseSchema,
  CreateTopupResponseSchema,
  HomeResponseSchema,
  MeResponseSchema,
  OrderDetailSchema,
  ProductDetailSchema,
  ProfileResponseSchema,
  type PricingBreakdown,
  type TopupMethod
} from '@/types/api'

function useApiEnabled(): boolean {
  const { isReady } = useTelegram()
  return isReady
}

/** Disabled queries in v5 report isLoading=false; treat "no data yet" as loading. */
function asLoading<T extends { isPending: boolean }>(query: T): T & { isLoading: boolean } {
  return { ...query, isLoading: query.isPending }
}

export function useHomeData() {
  const enabled = useApiEnabled()
  return asLoading(
    useQuery({
      queryKey: ['home'],
      queryFn: () => api.get('/api/home', HomeResponseSchema),
      enabled
    })
  )
}

export function useCatalogData() {
  const enabled = useApiEnabled()
  return asLoading(
    useQuery({
      queryKey: ['catalog'],
      queryFn: () => api.get('/api/catalog', CatalogResponseSchema),
      staleTime: 30_000,
      enabled
    })
  )
}

export function useMeData() {
  const enabled = useApiEnabled()
  return asLoading(
    useQuery({
      queryKey: ['me'],
      queryFn: () => api.get('/api/me', MeResponseSchema),
      staleTime: 15_000,
      enabled
    })
  )
}

export function useConfigData() {
  const enabled = useApiEnabled()
  return asLoading(
    useQuery({
      queryKey: ['config'],
      queryFn: () => api.get('/api/config', ConfigResponseSchema),
      staleTime: Infinity,
      enabled
    })
  )
}

export function useCategoryData(slug: string) {
  const enabled = useApiEnabled()
  return asLoading(
    useQuery({
      queryKey: ['category', slug],
      queryFn: () => api.get(`/api/categories/${slug}`, CategoryResponseSchema),
      enabled: enabled && Boolean(slug)
    })
  )
}

export function useProductData(slug: string) {
  const enabled = useApiEnabled()
  return asLoading(
    useQuery({
      queryKey: ['product', slug],
      queryFn: () => api.get(`/api/products/${slug}`, ProductDetailSchema),
      enabled: enabled && Boolean(slug)
    })
  )
}

export function useProfileData() {
  const enabled = useApiEnabled()
  return asLoading(
    useQuery({
      queryKey: ['profile'],
      queryFn: () => api.get('/api/profile', ProfileResponseSchema),
      staleTime: 15_000,
      enabled
    })
  )
}

interface PreviewPricingInput {
  planId: string
  qty: number
  promoCode?: string
}

export function usePricingPreview() {
  return useMutation({
    mutationFn: (input: PreviewPricingInput) =>
      api.post<PricingBreakdown>(
        '/api/pricing/preview',
        // Reuse the response schema shape from CreateOrderResponseSchema's pricing field.
        CreateOrderResponseSchema.shape.pricing,
        input
      )
  })
}

interface CreateOrderInput {
  planId: string
  qty: number
  promoCode?: string
  provider: 'BALANCE' | 'CRYPTOBOT' | 'STARS' | 'TRON_TRC20'
  idempotencyKey: string
}

/** Money moved (or may move soon): every screen that shows a balance refetches. */
function invalidateBalanceViews(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: ['me'] })
  void queryClient.invalidateQueries({ queryKey: ['profile'] })
}

export function useCreateOrder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateOrderInput) => api.post('/api/orders', CreateOrderResponseSchema, input),
    onSuccess: () => invalidateBalanceViews(queryClient)
  })
}

export function useOrderDetail(orderId: string, pollWhilePending: boolean) {
  const enabled = useApiEnabled()
  const queryClient = useQueryClient()
  return asLoading(
    useQuery({
      queryKey: ['order', orderId],
      queryFn: async () => {
        const order = await api.get(`/api/orders/${orderId}`, OrderDetailSchema)
        // The order left PENDING between two polls — its payment (balance
        // debit, top-up credit on refund) is reflected in the cached balance.
        const previous = queryClient.getQueryData<{ status: string }>(['order', orderId])
        if (previous && previous.status !== order.status) invalidateBalanceViews(queryClient)
        return order
      },
      enabled: enabled && Boolean(orderId),
      refetchInterval: (query) => {
        if (!pollWhilePending) return false
        const status = query.state.data?.status
        if (status === 'PENDING' || status === 'DELIVERING') return 3_000
        return false
      }
    })
  )
}

interface CreateTopupInput {
  amountCents: number
  method: TopupMethod
  idempotencyKey: string
}

export function useCreateTopup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateTopupInput) => api.post('/api/topups', CreateTopupResponseSchema, input),
    onSuccess: () => invalidateBalanceViews(queryClient)
  })
}

const OPEN_TOPUP_STATUSES = new Set(['PENDING', 'CONFIRMING'])

/**
 * Polls a created top-up until the provider settles it. GET /api/topups/:id
 * answers with the same shape as the create call, so the balance screen can
 * keep rendering the invoice and switch to a success/failure state in place.
 */
export function useTopupDetail(paymentId: string | null) {
  const enabled = useApiEnabled()
  const queryClient = useQueryClient()
  return asLoading(
    useQuery({
      queryKey: ['topup', paymentId],
      queryFn: async () => {
        const topup = await api.get(`/api/topups/${paymentId}`, CreateTopupResponseSchema)
        const previous = queryClient.getQueryData<{ status: string }>(['topup', paymentId])
        if (previous && previous.status !== topup.status) invalidateBalanceViews(queryClient)
        return topup
      },
      enabled: enabled && Boolean(paymentId),
      refetchInterval: (query) => {
        const status = query.state.data?.status
        if (!status || OPEN_TOPUP_STATUSES.has(status)) return 3_000
        return false
      }
    })
  )
}
