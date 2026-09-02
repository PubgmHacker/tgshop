import { z } from 'zod'

// ─────────────────────────────────────────────────────────────────────────────
// Mirrors @tgshop/db enums (string unions) for zod parsing on the client.
// ─────────────────────────────────────────────────────────────────────────────

export const DeliveryTypeSchema = z.enum(['STOCK_POOL', 'UNIQUE_CODE', 'EXTERNAL_API', 'MANUAL_FALLBACK'])
export const OrderStatusSchema = z.enum([
  'PENDING',
  'PAID',
  'DELIVERING',
  'DELIVERED',
  'FAILED',
  'REFUNDED',
  'EXPIRED'
])
export const PaymentStatusSchema = z.enum(['PENDING', 'CONFIRMING', 'PAID', 'UNDERPAID', 'EXPIRED', 'FAILED'])
export const PaymentProviderSchema = z.enum(['BALANCE', 'CRYPTOBOT', 'STARS', 'TRON_TRC20'])
export const SubStatusSchema = z.enum(['ACTIVE', 'EXPIRED', 'CANCELLED'])
export const LedgerTypeSchema = z.enum(['TOPUP', 'PURCHASE', 'REFUND', 'ADMIN_ADJUST', 'REFERRAL', 'SWEEP_ADJUST'])

export const AuthResponseSchema = z.object({
  accessToken: z.string(),
  expiresAt: z.string(),
  user: z.object({
    id: z.string(),
    languageCode: z.string().nullable(),
    balanceCents: z.number().int()
  })
})
export type AuthResponse = z.infer<typeof AuthResponseSchema>

export const CategorySchema = z.object({
  id: z.string(),
  title: z.string(),
  slug: z.string(),
  emoji: z.string().nullable()
})
export type Category = z.infer<typeof CategorySchema>

export const PlanSchema = z.object({
  id: z.string(),
  title: z.string(),
  durationDays: z.number().int().nullable(),
  priceCents: z.number().int(),
  priceStars: z.number().int().nullable(),
  discountPercent: z.number().int(),
  inStock: z.boolean(),
  lowStock: z.boolean()
})
export type Plan = z.infer<typeof PlanSchema>

export const ProductSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  slug: z.string(),
  imageUrl: z.string().nullable(),
  categorySlug: z.string(),
  minPriceCents: z.number().int(),
  maxDiscountPercent: z.number().int(),
  inStock: z.boolean()
})
export type ProductSummary = z.infer<typeof ProductSummarySchema>

export const ProductDetailSchema = z.object({
  id: z.string(),
  title: z.string(),
  slug: z.string(),
  description: z.string(),
  imageUrl: z.string().nullable(),
  deliveryType: DeliveryTypeSchema,
  categorySlug: z.string(),
  categoryTitle: z.string(),
  plans: z.array(PlanSchema)
})
export type ProductDetail = z.infer<typeof ProductDetailSchema>

export const HomeBannerSchema = z.object({
  id: z.string(),
  imageUrl: z.string(),
  title: z.string().nullable(),
  href: z.string().nullable()
})
export type HomeBanner = z.infer<typeof HomeBannerSchema>

export const HomeResponseSchema = z.object({
  banners: z.array(HomeBannerSchema),
  categories: z.array(CategorySchema),
  bestsellers: z.array(ProductSummarySchema)
})
export type HomeResponse = z.infer<typeof HomeResponseSchema>

export const CategoryResponseSchema = z.object({
  category: CategorySchema,
  products: z.array(ProductSummarySchema)
})
export type CategoryResponse = z.infer<typeof CategoryResponseSchema>

export const PromoPreviewSchema = z.object({
  code: z.string(),
  discountCents: z.number().int()
})

export const PricingBreakdownSchema = z.object({
  planId: z.string(),
  qty: z.number().int(),
  unitPriceCents: z.number().int(),
  subtotalCents: z.number().int(),
  promoCode: z.string().nullable(),
  promoDiscountCents: z.number().int(),
  totalCents: z.number().int()
})
export type PricingBreakdown = z.infer<typeof PricingBreakdownSchema>

export const CreateOrderResponseSchema = z.object({
  orderId: z.string(),
  status: OrderStatusSchema,
  pricing: PricingBreakdownSchema,
  /** Off-site payment page (CryptoBot) or Stars invoice link. Absent for BALANCE. */
  payUrl: z.string().nullish(),
  /** Whole Stars to charge, STARS provider only. */
  stars: z.number().int().nullish(),
  tron: z
    .object({
      address: z.string(),
      network: z.literal('TRC20'),
      amountUsdt6: z.string(),
      amountDisplay: z.string(),
      expiresAt: z.string()
    })
    .nullish()
})
export type CreateOrderResponse = z.infer<typeof CreateOrderResponseSchema>

export const TronPaymentDetailsSchema = z.object({
  address: z.string(),
  network: z.literal('TRC20'),
  amountUsdt6: z.string(),
  /** Exact amount as the customer must type it, e.g. "29.0057" — the sub-cent tail identifies the invoice. */
  amountDisplay: z.string(),
  expiresAt: z.string()
})
export type TronPaymentDetails = z.infer<typeof TronPaymentDetailsSchema>

export const OrderDetailSchema = z.object({
  id: z.string(),
  status: OrderStatusSchema,
  provider: PaymentProviderSchema,
  planTitle: z.string(),
  productTitle: z.string(),
  qty: z.number().int(),
  amountCents: z.number().int(),
  createdAt: z.string(),
  paidAt: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  deliveredPayload: z.string().nullable(),
  paymentStatus: PaymentStatusSchema.nullable(),
  payUrl: z.string().nullable(),
  tron: TronPaymentDetailsSchema.nullable()
})
export type OrderDetail = z.infer<typeof OrderDetailSchema>

export const OrderListItemSchema = z.object({
  id: z.string(),
  status: OrderStatusSchema,
  productTitle: z.string(),
  planTitle: z.string(),
  amountCents: z.number().int(),
  createdAt: z.string()
})
export type OrderListItem = z.infer<typeof OrderListItemSchema>

export const SubscriptionItemSchema = z.object({
  id: z.string(),
  productTitle: z.string(),
  planTitle: z.string(),
  status: SubStatusSchema,
  startsAt: z.string(),
  expiresAt: z.string(),
  autoRenew: z.boolean()
})
export type SubscriptionItem = z.infer<typeof SubscriptionItemSchema>

export const ProfileResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    balanceCents: z.number().int(),
    languageCode: z.string().nullable(),
    referralCode: z.string(),
    referralCount: z.number().int()
  }),
  orders: z.array(OrderListItemSchema),
  subscriptions: z.array(SubscriptionItemSchema)
})
export type ProfileResponse = z.infer<typeof ProfileResponseSchema>

export const MeResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    tgId: z.string(),
    username: z.string().nullable(),
    firstName: z.string().nullable(),
    languageCode: z.string().nullable(),
    isBlocked: z.boolean(),
    createdAt: z.string()
  }),
  balanceCents: z.number().int(),
  totalSpentCents: z.number().int(),
  referral: z.object({
    code: z.string(),
    link: z.string(),
    count: z.number().int(),
    earningsCents: z.number().int()
  })
})
export type MeResponse = z.infer<typeof MeResponseSchema>

export const TopupMethodSchema = z.enum(['CRYPTOBOT', 'STARS', 'TRON_TRC20'])
export type TopupMethod = z.infer<typeof TopupMethodSchema>

export const ConfigResponseSchema = z.object({
  botUsername: z.string(),
  supportUrl: z.string(),
  paymentMethods: z.array(PaymentProviderSchema),
  topupMethods: z.array(TopupMethodSchema),
  minTopupCents: z.number().int().positive()
})
export type ConfigResponse = z.infer<typeof ConfigResponseSchema>

export const CatalogResponseSchema = z.object({
  categories: z.array(
    CategorySchema.extend({
      products: z.array(ProductDetailSchema)
    })
  )
})
export type CatalogResponse = z.infer<typeof CatalogResponseSchema>

export const CreateTopupResponseSchema = z.object({
  paymentId: z.string(),
  provider: PaymentProviderSchema,
  status: PaymentStatusSchema,
  redirectUrl: z.string().nullable(),
  tron: TronPaymentDetailsSchema.nullable()
})
export type CreateTopupResponse = z.infer<typeof CreateTopupResponseSchema>

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string()
  })
})
export type ApiError = z.infer<typeof ApiErrorSchema>
