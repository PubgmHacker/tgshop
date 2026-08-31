import { prisma, StockStatus, type DeliveryType } from '@tgshop/db'
import { isPoolBacked as coreIsPoolBacked } from '@tgshop/core'

// ─────────────────────────────────────────────────────────────────────────────
// Stock availability helpers.
//
// STOCK_POOL / UNIQUE_CODE products sell from a pool of pre-encrypted
// StockItem rows, so availability is a live COUNT. EXTERNAL_API and
// MANUAL_FALLBACK products are fulfilled out of band and are therefore always
// purchasable regardless of the (empty) local pool — see domain/orders.ts,
// which routes those through core's deliver() instead.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Whether a plan's availability is backed by a local StockItem pool.
 *
 * Delegates to core so this cannot drift from what delivery actually does. The
 * local copy this replaced classified every UNIQUE_CODE product as pool-backed,
 * while core's deliver() mints codes from `externalConfig.codeTemplate` when one
 * is present and never touches the pool — so a templated product would be
 * reported "out of stock" and blocked from sale despite having infinite supply.
 * Pass `externalConfig` to get that right; callers that omit it keep the old
 * pool-backed answer for UNIQUE_CODE.
 */
export function isPoolBacked(deliveryType: string, externalConfig: unknown = null): boolean {
  // DeliveryType is a string enum and core only compares it for equality, so
  // widening the caller's `string` back to it is safe.
  return coreIsPoolBacked(deliveryType as DeliveryType, externalConfig)
}

export interface PlanAvailability {
  available: number
  inStock: boolean
  lowStock: boolean
}

/** Counts AVAILABLE stock items for a single plan. */
export async function countAvailableForPlan(planId: string): Promise<number> {
  return prisma.stockItem.count({ where: { planId, status: StockStatus.AVAILABLE } })
}

/**
 * Counts AVAILABLE stock for many plans in ONE query, returning a Map keyed by
 * planId. Plans with no available rows are absent from the map (callers should
 * treat a miss as 0) — this avoids the N+1 the per-plan counter would cause
 * when rendering the whole catalog.
 */
export async function countAvailableForPlans(planIds: readonly string[]): Promise<Map<string, number>> {
  if (planIds.length === 0) return new Map()

  const grouped = await prisma.stockItem.groupBy({
    by: ['planId'],
    where: { planId: { in: [...planIds] }, status: StockStatus.AVAILABLE },
    _count: { _all: true }
  })

  const counts = new Map<string, number>()
  for (const row of grouped) {
    counts.set(row.planId, row._count._all)
  }
  return counts
}

/**
 * Derives the availability flags the Mini App renders for a plan.
 * `deliveryType` comes from the plan's parent product.
 */
export function planAvailability(
  deliveryType: string,
  lowStockThreshold: number,
  availableCount: number,
  externalConfig: unknown = null
): PlanAvailability {
  if (!isPoolBacked(deliveryType, externalConfig)) {
    // Fulfilled out of band — never blocked by the local pool.
    return { available: availableCount, inStock: true, lowStock: false }
  }
  return {
    available: availableCount,
    inStock: availableCount > 0,
    lowStock: availableCount > 0 && availableCount <= lowStockThreshold
  }
}

export interface LowStockPlan {
  planId: string
  planTitle: string
  productId: string
  productTitle: string
  productSlug: string
  categoryTitle: string
  categorySlug: string
  available: number
  lowStockThreshold: number
  priceCents: number
}

/**
 * Lists active, pool-backed plans whose AVAILABLE stock is at or below their
 * own lowStockThreshold, with product/category context. Powers /internal/stock
 * and the low-stock promo agent (docs/AGENT_PLAN.md).
 */
export async function getLowStockPlans(): Promise<LowStockPlan[]> {
  const plans = await prisma.plan.findMany({
    where: { isActive: true, product: { isActive: true } },
    include: { product: { include: { category: true } } }
  })

  const counts = await countAvailableForPlans(plans.map((p) => p.id))

  return plans
    .filter((plan) => isPoolBacked(plan.product.deliveryType, plan.product.externalConfig))
    .map((plan) => ({
      planId: plan.id,
      planTitle: plan.title,
      productId: plan.product.id,
      productTitle: plan.product.title,
      productSlug: plan.product.slug,
      categoryTitle: plan.product.category.title,
      categorySlug: plan.product.category.slug,
      available: counts.get(plan.id) ?? 0,
      lowStockThreshold: plan.lowStockThreshold,
      priceCents: plan.priceCents
    }))
    .filter((row) => row.available <= row.lowStockThreshold)
    .sort((a, b) => a.available - b.available)
}
