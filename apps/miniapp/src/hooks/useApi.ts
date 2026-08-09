'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import {
  CategoryResponseSchema,
  CreateOrderResponseSchema,
  CreateTopupResponseSchema,
  HomeResponseSchema,
  OrderDetailSchema,
  ProductDetailSchema,
  ProfileResponseSchema,
  type PricingBreakdown,
  type TopupMethod
} from '@/types/api'

export function useHomeData() {
  return useQuery({
    queryKey: ['home'],
    queryFn: () => api.get('/api/home', HomeResponseSchema)
  })
}

export function useCategoryData(slug: string) {
  return useQuery({
    queryKey: ['category', slug],
    queryFn: () => api.get(`/api/categories/${slug}`, CategoryResponseSchema),
    enabled: Boolean(slug)
  })
}

export function useProductData(slug: string) {
  return useQuery({
    queryKey: ['product', slug],
    queryFn: () => api.get(`/api/products/${slug}`, ProductDetailSchema),
    enabled: Boolean(slug)
  })
}

export function useProfileData() {
  return useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get('/api/profile', ProfileResponseSchema),
    staleTime: 15_000
  })
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
  return useQuery({
    queryKey: ['order', orderId],
    queryFn: () => api.get(`/api/orders/${orderId}`, OrderDetailSchema),
    enabled: Boolean(orderId),
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
