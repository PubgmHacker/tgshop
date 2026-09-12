import { z } from 'zod'

// ─────────────────────────────────────────────────────────────────────────────
// Mirrors @tgshop/db enums (string unions) for zod parsing on the client, plus
// the /api/admin/* response DTOs. Field names track the route handlers in
// apps/bot/src/server/routes/api/admin — change those, change these.
// ─────────────────────────────────────────────────────────────────────────────

export const DeliveryTypeSchema = z.enum([
  'STOCK_POOL',
  'UNIQUE_CODE',
  'EXTERNAL_API',
  'MANUAL_FALLBACK'
])
export type DeliveryType = z.infer<typeof DeliveryTypeSchema>

export const OrderStatusSchema = z.enum([
  'PENDING',
  'PAID',
  'DELIVERING',
  'DELIVERED',
  'FAILED',
  'REFUNDED',
  'EXPIRED'
])
export type OrderStatus = z.infer<typeof OrderStatusSchema>

export const PaymentStatusSchema = z.enum([
  'PENDING',
  'CONFIRMING',
  'PAID',
  'UNDERPAID',
  'EXPIRED',
  'FAILED'
])
export const PaymentProviderSchema = z.enum(['BALANCE', 'CRYPTOBOT', 'STARS', 'TRON_TRC20'])
export type PaymentProvider = z.infer<typeof PaymentProviderSchema>
export const LedgerTypeSchema = z.enum([
  'TOPUP',
  'PURCHASE',
  'REFUND',
  'ADMIN_ADJUST',
  'REFERRAL',
  'SWEEP_ADJUST'
])
export const StockStatusSchema = z.enum(['AVAILABLE', 'RESERVED', 'SOLD'])
export const PromoTypeSchema = z.enum(['PERCENT', 'FIXED'])
export type PromoType = z.infer<typeof PromoTypeSchema>

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

// ── Dashboard ────────────────────────────────────────────────────────────────

export const RevenueWindowSchema = z.object({
  grossCents: z.number().int(),
  refundedCents: z.number().int(),
  paidOrders: z.number().int()
})
export type RevenueWindow = z.infer<typeof RevenueWindowSchema>

export const OrderUserRefSchema = z.object({
  tgId: z.string(),
  username: z.string().nullable(),
  firstName: z.string().nullable()
})
export type OrderUserRef = z.infer<typeof OrderUserRefSchema>

export const StatsResponseSchema = z.object({
  revenue: z.object({
    today: RevenueWindowSchema,
    last7d: RevenueWindowSchema,
    last30d: RevenueWindowSchema,
    total: RevenueWindowSchema
  }),
  ordersByStatus: z.record(z.string(), z.number().int()),
  users: z.object({
    total: z.number().int(),
    newToday: z.number().int(),
    blocked: z.number().int()
  }),
  lowStock: z.array(
    z.object({
      planId: z.string(),
      planTitle: z.string(),
      productId: z.string(),
      productTitle: z.string(),
      availableCount: z.number().int(),
      lowStockThreshold: z.number().int()
    })
  ),
  pendingRefunds: z.array(
    z.object({
      orderId: z.string(),
      amountCents: z.number().int(),
      reason: z.string(),
      requestedBy: z.string(),
      requestedAt: z.string()
    })
  ),
  recentOrders: z.array(
    z.object({
      id: z.string(),
      status: OrderStatusSchema,
      provider: PaymentProviderSchema,
      amountCents: z.number().int(),
      productTitle: z.string(),
      planTitle: z.string(),
      user: OrderUserRefSchema,
      createdAt: z.string()
    })
  )
})
export type StatsResponse = z.infer<typeof StatsResponseSchema>

// ── Orders ───────────────────────────────────────────────────────────────────

export const AdminOrderRowSchema = z.object({
  id: z.string(),
  status: OrderStatusSchema,
  provider: PaymentProviderSchema,
  amountCents: z.number().int(),
  currency: z.string(),
  qty: z.number().int(),
  planTitle: z.string(),
  productTitle: z.string(),
  promoCode: z.string().nullable(),
  user: OrderUserRefSchema.extend({ id: z.string() }),
  createdAt: z.string(),
  paidAt: z.string().nullable(),
  isDelivered: z.boolean()
})
export type AdminOrderRow = z.infer<typeof AdminOrderRowSchema>

/** StatusPill (shared glass component) types itself off this alias. */
export type OrderListItem = AdminOrderRow

export const OrderListResponseSchema = z.object({
  orders: z.array(AdminOrderRowSchema),
  nextCursor: z.string().nullable()
})
export type OrderListResponse = z.infer<typeof OrderListResponseSchema>

export const OrderDetailResponseSchema = z.object({
  order: AdminOrderRowSchema.extend({
    planId: z.string(),
    productId: z.string(),
    deliveryType: DeliveryTypeSchema,
    customerEmail: z.string().nullable(),
    deliveredAt: z.string().nullable(),
    expiresAt: z.string().nullable(),
    refundedCents: z.number().int()
  }),
  payments: z.array(
    z.object({
      id: z.string(),
      provider: PaymentProviderSchema,
      status: PaymentStatusSchema,
      amount: z.string(),
      asset: z.string().nullable(),
      network: z.string().nullable(),
      txHash: z.string().nullable(),
      createdAt: z.string()
    })
  ),
  ledger: z.array(
    z.object({
      id: z.string(),
      type: LedgerTypeSchema,
      amountCents: z.number().int(),
      comment: z.string().nullable(),
      createdAt: z.string()
    })
  )
})
export type OrderDetailResponse = z.infer<typeof OrderDetailResponseSchema>

export const RefundResponseSchema = z.object({
  status: z.literal('REFUNDED'),
  alreadyRefunded: z.boolean(),
  orderId: z.string(),
  refundedCents: z.number().int()
})
export type RefundResponse = z.infer<typeof RefundResponseSchema>

export const ManualDeliveryResponseSchema = z.object({
  orderId: z.string(),
  status: z.literal('DELIVERED'),
  buyerNotified: z.boolean()
})
export type ManualDeliveryResponse = z.infer<typeof ManualDeliveryResponseSchema>

// ── Catalog ──────────────────────────────────────────────────────────────────

export const StockCountsSchema = z.object({
  available: z.number().int(),
  reserved: z.number().int(),
  sold: z.number().int()
})
export type StockCounts = z.infer<typeof StockCountsSchema>

export const AdminPlanSchema = z.object({
  id: z.string(),
  title: z.string(),
  durationDays: z.number().int().nullable(),
  priceCents: z.number().int(),
  priceStars: z.number().int().nullable(),
  discountPercent: z.number().int(),
  lowStockThreshold: z.number().int(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  stock: StockCountsSchema
})
export type AdminPlan = z.infer<typeof AdminPlanSchema>

export const AdminProductSchema = z.object({
  id: z.string(),
  title: z.string(),
  slug: z.string(),
  description: z.string(),
  imageUrl: z.string().nullable(),
  deliveryType: DeliveryTypeSchema,
  usesStock: z.boolean().optional(),
  externalConfig: z.unknown().nullable(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  plans: z.array(AdminPlanSchema)
})
export type AdminProduct = z.infer<typeof AdminProductSchema>

export const AdminCategorySchema = z.object({
  id: z.string(),
  title: z.string(),
  slug: z.string(),
  emoji: z.string().nullable(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  products: z.array(AdminProductSchema)
})
export type AdminCategory = z.infer<typeof AdminCategorySchema>

export const CatalogResponseSchema = z.object({
  categories: z.array(AdminCategorySchema)
})
export type CatalogResponse = z.infer<typeof CatalogResponseSchema>

export const CreatedResponseSchema = z.object({ id: z.string() })
export const ProductCreatedResponseSchema = CreatedResponseSchema.extend({
  broadcastDraftId: z.string().nullable().optional()
})
export const UpdatedResponseSchema = z.object({ id: z.string() })
export const DeletedResponseSchema = z.object({ id: z.string(), deleted: z.boolean() })

// ── Stock ────────────────────────────────────────────────────────────────────

export const StockDetailResponseSchema = z.object({
  plan: z.object({
    usesStock: z.boolean().optional(),
    id: z.string(),
    title: z.string(),
    lowStockThreshold: z.number().int(),
    productId: z.string(),
    productTitle: z.string(),
    deliveryType: DeliveryTypeSchema
  }),
  counts: StockCountsSchema,
  recent: z.array(
    z.object({
      id: z.string(),
      status: StockStatusSchema,
      orderId: z.string().nullable(),
      createdAt: z.string()
    })
  )
})
export type StockDetailResponse = z.infer<typeof StockDetailResponseSchema>

export const StockAddResponseSchema = z.object({ planId: z.string(), added: z.number().int() })
export const StockDeleteResponseSchema = z.object({ itemId: z.string(), deleted: z.boolean() })

// ── Promos ───────────────────────────────────────────────────────────────────

export const AdminPromoSchema = z.object({
  id: z.string(),
  code: z.string(),
  type: PromoTypeSchema,
  value: z.number().int(),
  maxUses: z.number().int().nullable(),
  usedCount: z.number().int(),
  expiresAt: z.string().nullable(),
  planId: z.string().nullable(),
  planTitle: z.string().nullable(),
  isActive: z.boolean()
})
export type AdminPromo = z.infer<typeof AdminPromoSchema>

export const PromoListResponseSchema = z.object({ promos: z.array(AdminPromoSchema) })

// ── Broadcasts ──────────────────────────────────────────────────────────────

export const PostStatusSchema = z.enum([
  'DRAFT',
  'SCHEDULED',
  'QUEUED',
  'SENDING',
  'SENT',
  'FAILED',
  'CANCELLED'
])
export type PostStatus = z.infer<typeof PostStatusSchema>

export const BroadcastSegmentSchema = z.enum([
  'all',
  'buyers',
  'inactive_30d',
  'active_subscribers',
  'no_purchases'
])
export type BroadcastSegment = z.infer<typeof BroadcastSegmentSchema>

export const BroadcastStatsSchema = z
  .object({
    total: z.number().int().nonnegative().optional(),
    sent: z.number().int().nonnegative().optional(),
    blocked: z.number().int().nonnegative().optional(),
    failed: z.number().int().nonnegative().optional()
  })
  .passthrough()

export const AdminBroadcastSchema = z.object({
  id: z.string(),
  status: PostStatusSchema,
  source: z.enum(['MANUAL', 'AGENT']),
  text: z.string(),
  segment: BroadcastSegmentSchema.nullable(),
  mediaUrl: z.string().nullable(),
  scheduledAt: z.string().nullable(),
  sentAt: z.string().nullable(),
  statsJson: BroadcastStatsSchema.nullable(),
  createdAt: z.string()
})
export type AdminBroadcast = z.infer<typeof AdminBroadcastSchema>

export const BroadcastListResponseSchema = z.object({
  posts: z.array(AdminBroadcastSchema),
  templates: z.array(z.object({ id: z.string(), title: z.string(), text: z.string() })).default([]),
  segments: z.array(
    z.object({
      value: BroadcastSegmentSchema,
      count: z.number().int().nonnegative()
    })
  )
})
export type BroadcastListResponse = z.infer<typeof BroadcastListResponseSchema>

export const BroadcastMutationResponseSchema = z.object({ post: AdminBroadcastSchema })
export const BroadcastDeleteResponseSchema = z.object({ id: z.string(), deleted: z.boolean() })

// ── Users ────────────────────────────────────────────────────────────────────

export const AdminUserRowSchema = z.object({
  id: z.string(),
  tgId: z.string(),
  username: z.string().nullable(),
  firstName: z.string().nullable(),
  languageCode: z.string().nullable(),
  isBlocked: z.boolean(),
  isAdmin: z.boolean(),
  ordersCount: z.number().int(),
  referralsCount: z.number().int(),
  createdAt: z.string()
})
export type AdminUserRow = z.infer<typeof AdminUserRowSchema>

export const UserListResponseSchema = z.object({
  users: z.array(AdminUserRowSchema),
  nextCursor: z.string().nullable()
})
export type UserListResponse = z.infer<typeof UserListResponseSchema>

export const UserDetailResponseSchema = z.object({
  user: AdminUserRowSchema,
  balanceCents: z.number().int(),
  totalSpentCents: z.number().int(),
  totalToppedUpCents: z.number().int(),
  orders: z.array(
    z.object({
      id: z.string(),
      status: OrderStatusSchema,
      provider: PaymentProviderSchema,
      amountCents: z.number().int(),
      productTitle: z.string(),
      planTitle: z.string(),
      createdAt: z.string()
    })
  ),
  ledger: z.array(
    z.object({
      id: z.string(),
      type: LedgerTypeSchema,
      amountCents: z.number().int(),
      orderId: z.string().nullable(),
      comment: z.string().nullable(),
      createdAt: z.string()
    })
  )
})
export type UserDetailResponse = z.infer<typeof UserDetailResponseSchema>

export const BalanceAdjustResponseSchema = z.object({
  userId: z.string(),
  balanceCents: z.number().int()
})

export const BlockResponseSchema = z.object({
  userId: z.string(),
  isBlocked: z.boolean()
})

// ── Settings ─────────────────────────────────────────────────────────────────

export const SettingKindSchema = z.enum(['decimal', 'cents', 'int', 'percent', 'url', 'json', 'boolean'])
export type SettingKind = z.infer<typeof SettingKindSchema>

export const SettingItemSchema = z.object({
  key: z.string(),
  kind: SettingKindSchema,
  value: z.unknown()
})
export type SettingItem = z.infer<typeof SettingItemSchema>

export const SettingsResponseSchema = z.object({ settings: z.array(SettingItemSchema) })

export const SettingUpdateResponseSchema = z.object({ key: z.string(), value: z.unknown() })

// ── Audit ────────────────────────────────────────────────────────────────────

export const AuditEntrySchema = z.object({
  id: z.string(),
  actorType: z.string(),
  actorId: z.string(),
  action: z.string(),
  entity: z.string(),
  entityId: z.string(),
  diff: z.unknown().nullable(),
  createdAt: z.string()
})
export type AuditEntry = z.infer<typeof AuditEntrySchema>

export const AuditResponseSchema = z.object({
  entries: z.array(AuditEntrySchema),
  nextCursor: z.string().nullable()
})
export type AuditResponse = z.infer<typeof AuditResponseSchema>

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string()
  })
})
export type ApiError = z.infer<typeof ApiErrorSchema>
