import type { Category, Order, Payment, Plan, Product, Subscription } from '@tgshop/db'
import { decrypt } from '@tgshop/core'
import { planAvailability } from '../../../domain/stock.js'
import { tronDetailsFromPayment, type TronPaymentDetails } from '../../../domain/payments.js'

// ─────────────────────────────────────────────────────────────────────────────
// Wire shapes for the Mini App.
//
// These MUST stay in lockstep with apps/miniapp/src/types/api.ts — that file
// zod-parses every response, so a missing or mistyped field is a hard client
// error, not a cosmetic drift. Dates always go out as ISO strings.
// ─────────────────────────────────────────────────────────────────────────────

export interface CategoryDto {
  id: string
  title: string
  slug: string
  emoji: string | null
}

export interface PlanDto {
  id: string
  title: string
  durationDays: number | null
  priceCents: number
  priceStars: number | null
  discountPercent: number
  inStock: boolean
  lowStock: boolean
}

export interface ProductSummaryDto {
  id: string
  title: string
  slug: string
  imageUrl: string | null
  categorySlug: string
  minPriceCents: number
  maxDiscountPercent: number
  inStock: boolean
}

export interface ProductDetailDto {
  id: string
  title: string
  slug: string
  description: string
  imageUrl: string | null
  deliveryType: string
  categorySlug: string
  categoryTitle: string
  plans: PlanDto[]
}

export interface OrderListItemDto {
  id: string
  status: string
  productTitle: string
  planTitle: string
  amountCents: number
  createdAt: string
}

export interface OrderDetailDto {
  id: string
  status: string
  provider: string
  planTitle: string
  productTitle: string
  qty: number
  amountCents: number
  createdAt: string
  paidAt: string | null
  deliveredAt: string | null
  expiresAt: string | null
  deliveredPayload: string | null
  paymentStatus: string | null
  tron: TronPaymentDetails | null
}

export interface SubscriptionItemDto {
  id: string
  productTitle: string
  planTitle: string
  status: string
  startsAt: string
  expiresAt: string
  autoRenew: boolean
}

export function toCategoryDto(category: Category): CategoryDto {
  return { id: category.id, title: category.title, slug: category.slug, emoji: category.emoji }
}

export function toPlanDto(plan: Plan, deliveryType: string, availableCount: number): PlanDto {
  const availability = planAvailability(deliveryType, plan.lowStockThreshold, availableCount)
  return {
    id: plan.id,
    title: plan.title,
    durationDays: plan.durationDays,
    priceCents: plan.priceCents,
    priceStars: plan.priceStars,
    discountPercent: plan.discountPercent,
    inStock: availability.inStock,
    lowStock: availability.lowStock
  }
}

/**
 * Summary card for grids. `minPriceCents` is the cheapest *effective* price
 * (after each plan's own discountPercent) so the "from $X" label never
 * overstates what the user will pay.
 */
export function toProductSummaryDto(
  product: Product,
  categorySlug: string,
  plans: readonly Plan[],
  availability: ReadonlyMap<string, number>
): ProductSummaryDto {
  const planDtos = plans.map((plan) => toPlanDto(plan, product.deliveryType, availability.get(plan.id) ?? 0))
  const effectivePrices = plans.map((plan) =>
    plan.discountPercent > 0 ? Math.round((plan.priceCents * (100 - plan.discountPercent)) / 100) : plan.priceCents
  )

  return {
    id: product.id,
    title: product.title,
    slug: product.slug,
    imageUrl: product.imageUrl,
    categorySlug,
    minPriceCents: effectivePrices.length > 0 ? Math.min(...effectivePrices) : 0,
    maxDiscountPercent: plans.length > 0 ? Math.max(...plans.map((p) => p.discountPercent)) : 0,
    inStock: planDtos.some((plan) => plan.inStock)
  }
}

export function toProductDetailDto(
  product: Product,
  category: Category,
  plans: readonly Plan[],
  availability: ReadonlyMap<string, number>
): ProductDetailDto {
  return {
    id: product.id,
    title: product.title,
    slug: product.slug,
    description: product.description,
    imageUrl: product.imageUrl,
    deliveryType: product.deliveryType,
    categorySlug: category.slug,
    categoryTitle: category.title,
    plans: plans.map((plan) => toPlanDto(plan, product.deliveryType, availability.get(plan.id) ?? 0))
  }
}

type OrderWithPlan = Order & { plan: Plan & { product: Product } }

export function toOrderListItemDto(order: OrderWithPlan): OrderListItemDto {
  return {
    id: order.id,
    status: order.status,
    productTitle: order.plan.product.title,
    planTitle: order.plan.title,
    amountCents: order.amountCents,
    createdAt: order.createdAt.toISOString()
  }
}

/**
 * Full order view for the checkout screen.
 *
 * The delivered payload is decrypted server-side and only ever returned to the
 * order's owner (the caller is already authorized by the route). Ciphertext is
 * never sent to the client. A decryption failure degrades to `null` rather than
 * failing the whole request, so the user still sees their order status.
 */
export function toOrderDetailDto(order: OrderWithPlan, payment: Payment | null): OrderDetailDto {
  let deliveredPayload: string | null = null
  if (order.deliveredPayloadEnc) {
    try {
      deliveredPayload = decrypt(order.deliveredPayloadEnc)
    } catch {
      deliveredPayload = null
    }
  }

  return {
    id: order.id,
    status: order.status,
    provider: order.provider,
    planTitle: order.plan.title,
    productTitle: order.plan.product.title,
    qty: order.qty,
    amountCents: order.amountCents,
    createdAt: order.createdAt.toISOString(),
    paidAt: order.paidAt ? order.paidAt.toISOString() : null,
    deliveredAt: order.deliveredAt ? order.deliveredAt.toISOString() : null,
    expiresAt: order.expiresAt ? order.expiresAt.toISOString() : null,
    deliveredPayload,
    paymentStatus: payment ? payment.status : null,
    tron: payment ? tronDetailsFromPayment(payment) : null
  }
}

type SubscriptionWithPlan = Subscription & { plan: Plan & { product: Product } }

export function toSubscriptionItemDto(subscription: SubscriptionWithPlan): SubscriptionItemDto {
  return {
    id: subscription.id,
    productTitle: subscription.plan.product.title,
    planTitle: subscription.plan.title,
    status: subscription.status,
    startsAt: subscription.startsAt.toISOString(),
    expiresAt: subscription.expiresAt.toISOString(),
    autoRenew: subscription.autoRenew
  }
}
