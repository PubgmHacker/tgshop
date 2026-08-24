import { z } from 'zod'
import { DeliveryType, LedgerType, PaymentProvider, PromoType } from '@tgshop/db'

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  totp: z.string().optional()
})

/**
 * The Telegram Login Widget callback payload
 * (https://core.telegram.org/widgets/login#receiving-authorization-data).
 *
 * Validated even though `verifyTelegramLogin()` re-derives the HMAC over it: it
 * arrives as a raw query string, so a TypeScript type over it is a claim and
 * nothing more. `id`/`auth_date` are numbers here to keep `tg:${id}` from being
 * built out of something like `id=abc` (the HMAC itself is indifferent — the
 * check string runs every value through String()).
 *
 * `.passthrough()`, not the default strip: the check string is built from every
 * field except `hash`, so silently dropping a field Telegram adds later would
 * break verification for everyone. Passing unknown fields through is safe —
 * tampering with any of them fails the HMAC, which fails closed.
 */
export const telegramLoginSchema = z
  .object({
    id: z.number().int().positive(),
    first_name: z.string().min(1),
    last_name: z.string().optional(),
    username: z.string().optional(),
    photo_url: z.string().url().optional(),
    auth_date: z.number().int().positive(),
    hash: z.string().regex(/^[0-9a-f]{64}$/, 'hash must be 64 lowercase hex characters')
  })
  .passthrough()

export const categoryUpsertSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1).max(200),
  slug: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase alphanumeric with dashes'),
  emoji: z.string().max(8).optional().nullable(),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true)
})

export const productUpsertSchema = z.object({
  id: z.string().optional(),
  categoryId: z.string().min(1),
  title: z.string().min(1).max(200),
  slug: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase alphanumeric with dashes'),
  description: z.string().min(1),
  imageUrl: z.string().url().optional().nullable(),
  deliveryType: z.nativeEnum(DeliveryType),
  externalConfig: z.record(z.unknown()).optional().nullable(),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0)
})

export const planUpsertSchema = z.object({
  id: z.string().optional(),
  productId: z.string().min(1),
  title: z.string().min(1).max(200),
  durationDays: z.number().int().positive().optional().nullable(),
  priceCents: z.number().int().nonnegative(),
  priceStars: z.number().int().nonnegative().optional().nullable(),
  discountPercent: z.number().int().min(0).max(100).default(0),
  lowStockThreshold: z.number().int().min(0).default(3),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0)
})

export const stockBulkPasteSchema = z.object({
  planId: z.string().min(1),
  payloads: z
    .string()
    .min(1)
    .transform((value) =>
      value
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    )
    .pipe(z.array(z.string().min(1)).min(1).max(5000))
})

export const stockCsvImportSchema = z.object({
  planId: z.string().min(1),
  csv: z.string().min(1)
})

export const promoUpsertSchema = z.object({
  id: z.string().optional(),
  code: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[A-Z0-9_-]+$/, 'code must be uppercase alphanumeric, dash, or underscore'),
  type: z.nativeEnum(PromoType),
  value: z.number().int().nonnegative(),
  maxUses: z.number().int().positive().optional().nullable(),
  expiresAt: z.coerce.date().optional().nullable(),
  planId: z.string().optional().nullable(),
  isActive: z.boolean().default(true)
})

export const settingUpsertSchema = z.object({
  key: z.string().min(1).max(200),
  value: z.unknown()
})

// ─────────────────────────────────────────────────────────────────────────────
// Setting value validation.
//
// `Setting.value` is a free-form Json column, so the only place a shape can be
// enforced is here. Keys the shop actually reads (see packages/db/prisma/seed.ts)
// are described below and validated per-kind; any other key (e.g.
// `payment_provider:<id>`, `price_override:<asset>`) is accepted as arbitrary
// JSON so provider configs stay editable without a schema change here.
// ─────────────────────────────────────────────────────────────────────────────

export type SettingKind = 'string' | 'url' | 'int' | 'percent' | 'decimal' | 'boolean' | 'json'

export interface SettingDefinition {
  key: string
  label: string
  kind: SettingKind
  hint: string
}

export const SETTING_DEFINITIONS: readonly SettingDefinition[] = [
  {
    key: 'stars_usd_rate',
    label: 'Stars per USD',
    kind: 'decimal',
    hint: 'Decimal written as a JSON string, e.g. "0.013". Stored as a string to stay float-free.'
  },
  {
    key: 'min_topup_cents',
    label: 'Minimum top-up (cents)',
    kind: 'int',
    hint: 'Integer cents. 500 = $5.00'
  },
  { key: 'support_url', label: 'Support URL', kind: 'url', hint: 'Full URL, e.g. https://t.me/tgshop_support' },
  {
    key: 'referral_percent',
    label: 'Referral percent',
    kind: 'percent',
    hint: 'Integer 0-100. Share of a purchase credited to the referrer.'
  }
] as const

const settingKindSchemas: Record<SettingKind, z.ZodTypeAny> = {
  string: z.string().min(1).max(2000),
  url: z.string().url(),
  int: z.number().int().nonnegative(),
  percent: z.number().int().min(0).max(100),
  decimal: z.string().regex(/^\d+(\.\d+)?$/, 'must be a decimal number written as a string, e.g. "0.013"'),
  boolean: z.boolean(),
  json: z.unknown()
}

export function findSettingDefinition(key: string): SettingDefinition | undefined {
  return SETTING_DEFINITIONS.find((definition) => definition.key === key)
}

/**
 * Validates a Setting value against its known kind. Unknown keys pass through
 * untouched (any JSON is legal for them). Throws with the failing key named so
 * the message is useful straight from the admin form.
 */
export function parseSettingValue(key: string, value: unknown): unknown {
  const definition = findSettingDefinition(key)
  if (!definition) return value

  const result = settingKindSchemas[definition.kind].safeParse(value)
  if (!result.success) {
    const reason = result.error.issues.map((issue) => issue.message).join('; ')
    throw new Error(`Setting "${key}" failed validation: ${reason}`)
  }
  return result.data
}

export const balanceAdjustSchema = z.object({
  userId: z.string().min(1),
  amountCents: z.number().int().refine((v) => v !== 0, 'amountCents must be non-zero'),
  type: z.nativeEnum(LedgerType).default(LedgerType.ADMIN_ADJUST),
  comment: z.string().min(1).max(500)
})

export const userBanSchema = z.object({
  userId: z.string().min(1),
  isBlocked: z.boolean()
})

export const userSearchSchema = z.object({
  query: z.string().max(200).optional().default(''),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20)
})

export const orderFilterSchema = z.object({
  status: z.string().optional(),
  provider: z.nativeEnum(PaymentProvider).optional(),
  userId: z.string().optional(),
  query: z.string().max(200).optional(),
  dateFrom: z.coerce.date().optional().nullable(),
  dateTo: z.coerce.date().optional().nullable(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20)
})

export const orderRefundSchema = z.object({
  orderId: z.string().min(1),
  reason: z.string().min(1).max(500)
})

export const orderRedeliverSchema = z.object({
  orderId: z.string().min(1)
})

// trim() runs before min(1), so an all-whitespace "credential" is rejected
// here as well as in core — the operator sees a form error, not a 500.
export const orderManualDeliverSchema = z.object({
  orderId: z.string().min(1),
  payload: z.string().trim().min(1).max(10_000)
})

// ─────────────────────────────────────────────────────────────────────────────
// Broadcast segments.
//
// `BroadcastPost.segment` is a free-form column, but membership is defined once
// in @tgshop/core (segmentWhere / parseSegment) and shared by this panel's
// recipient preview and apps/worker's actual send. An unrecognized code
// resolves to ZERO recipients and fails the post rather than defaulting to
// "all", so a typo can never spam every user.
// ─────────────────────────────────────────────────────────────────────────────

export const BROADCAST_SEGMENT_VALUES = [
  'all',
  'buyers',
  'inactive_30d',
  'active_subscribers',
  'no_purchases'
] as const

export type BroadcastSegment = (typeof BROADCAST_SEGMENT_VALUES)[number]

export interface BroadcastSegmentDefinition {
  value: BroadcastSegment
  label: string
  /**
   * True when apps/worker can actually resolve this code. All five now share
   * @tgshop/core's segmentWhere(), so none can be silently empty — the flag is
   * kept so a future segment added here before the worker knows it still warns
   * the operator instead of scheduling a broadcast to nobody.
   */
  workerSupported: boolean
}

export const BROADCAST_SEGMENTS: readonly BroadcastSegmentDefinition[] = [
  { value: 'all', label: 'All users', workerSupported: true },
  { value: 'buyers', label: 'Buyers (1+ paid order)', workerSupported: true },
  { value: 'inactive_30d', label: 'Inactive 30 days', workerSupported: true },
  { value: 'active_subscribers', label: 'Active subscribers', workerSupported: true },
  { value: 'no_purchases', label: 'No purchases yet', workerSupported: true }
] as const

export const broadcastUpsertSchema = z.object({
  id: z.string().optional(),
  text: z.string().min(1).max(4096),
  mediaUrl: z.string().url().optional().nullable(),
  segment: z.enum(BROADCAST_SEGMENT_VALUES).optional().nullable(),
  scheduledAt: z.coerce.date().optional().nullable()
})

export const broadcastSendSchema = z.object({
  id: z.string().min(1)
})

export type LoginInput = z.infer<typeof loginSchema>
export type TelegramLoginInput = z.infer<typeof telegramLoginSchema>
export type CategoryUpsertInput = z.infer<typeof categoryUpsertSchema>
export type ProductUpsertInput = z.infer<typeof productUpsertSchema>
export type PlanUpsertInput = z.infer<typeof planUpsertSchema>
/**
 * NOTE: `z.input`, not `z.infer` — `payloads` is a raw textarea string on the way
 * in and only becomes `string[]` after the schema's split/trim transform runs.
 * Using the output type here would make the action signature demand an array
 * that `stockBulkPasteSchema.parse()` would then reject at runtime.
 */
export type StockBulkPasteInput = z.input<typeof stockBulkPasteSchema>
export type StockCsvImportInput = z.infer<typeof stockCsvImportSchema>
export type PromoUpsertInput = z.infer<typeof promoUpsertSchema>
export type SettingUpsertInput = z.infer<typeof settingUpsertSchema>
export type BalanceAdjustInput = z.infer<typeof balanceAdjustSchema>
export type UserBanInput = z.infer<typeof userBanSchema>
export type UserSearchInput = z.infer<typeof userSearchSchema>
export type OrderFilterInput = z.infer<typeof orderFilterSchema>
export type OrderRefundInput = z.infer<typeof orderRefundSchema>
export type OrderRedeliverInput = z.infer<typeof orderRedeliverSchema>
export type OrderManualDeliverInput = z.infer<typeof orderManualDeliverSchema>
export type BroadcastUpsertInput = z.infer<typeof broadcastUpsertSchema>
export type BroadcastSendInput = z.infer<typeof broadcastSendSchema>
