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
  return useQuery({
    queryKey: ['config'],
    queryFn: () => api.get('/api/config', ConfigResponseSchema),
    staleTime: Infinity,
    enabled
  })
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

export function useCreateOrder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateOrderInput) => api.post('/api/orders', CreateOrderResponseSchema, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profile'] })
    }
  })
}

export function useOrderDetail(orderId: string, pollWhilePending: boolean) {
  const enabled = useApiEnabled()
  return useQuery({
    queryKey: ['order', orderId],
    queryFn: () => api.get(`/api/orders/${orderId}`, OrderDetailSchema),
    enabled: enabled && Boolean(orderId),
    refetchInterval: (query) => {
      if (!pollWhilePending) return false
      const status = query.state.data?.status
      if (status === 'PENDING' || status === 'DELIVERING') return 3_000
      return false
    }
  })
}

interface CreateTopupInput {
  amountCents: number
  method: TopupMethod
  idempotencyKey: string
}

export function useCreateTopup() {
  return useMutation({
    mutationFn: (input: CreateTopupInput) => api.post('/api/topups', CreateTopupResponseSchema, input)
  })
}
