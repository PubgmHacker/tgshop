import type { PrismaClient } from '@tgshop/db'
import { StockStatus } from '@tgshop/db'
import { isPoolBacked } from './delivery.js'
import type { PrismaTx } from './ledger.js'

// ─────────────────────────────────────────────────────────────────────────────
// Stock levels.
//
// "Available" always means status = AVAILABLE only: RESERVED items belong to an
// in-flight checkout and must not be counted as sellable, or two buyers get
// promised the same credential.
//
// Products that are not pool-backed (EXTERNAL_API, and UNIQUE_CODE with a
// generator template) have no finite stock — they are excluded from low-stock
// reporting instead of permanently reporting zero.
// ─────────────────────────────────────────────────────────────────────────────

export async function countAvailable(
  prisma: PrismaClient | PrismaTx,
  planId: string
): Promise<number> {
  return prisma.stockItem.count({
    where: { planId, status: StockStatus.AVAILABLE }
  })
}

/** Available counts for many plans in ONE groupBy — never a per-plan query loop. */
export async function countAvailableForPlans(
  prisma: PrismaClient,
  planIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (planIds.length === 0) return counts

  const unique = [...new Set(planIds)]
  for (const planId of unique) counts.set(planId, 0)

  const rows = await prisma.stockItem.groupBy({
    by: ['planId'],
    where: { planId: { in: unique }, status: StockStatus.AVAILABLE },
    _count: { _all: true }
  })

  for (const row of rows) {
    counts.set(row.planId, row._count?._all ?? 0)
  }

  return counts
}

export interface LowStockPlan {
  planId: string
  planTitle: string
  available: number
  threshold: number
}

/** Active, pool-backed plans whose AVAILABLE count is at or below their threshold. */
export async function getLowStockPlans(prisma: PrismaClient): Promise<LowStockPlan[]> {
  const plans = await prisma.plan.findMany({
    where: { isActive: true, product: { isActive: true } },
    select: {
      id: true,
      title: true,
      lowStockThreshold: true,
      product: { select: { deliveryType: true, externalConfig: true } }
    }
  })

  const poolBacked = plans.filter((plan) =>
    isPoolBacked(plan.product.deliveryType, plan.product.externalConfig)
  )
  if (poolBacked.length === 0) return []

  const counts = await countAvailableForPlans(
    prisma,
    poolBacked.map((plan) => plan.id)
  )

  return poolBacked
    .map((plan) => ({
      planId: plan.id,
      planTitle: plan.title,
      available: counts.get(plan.id) ?? 0,
      threshold: plan.lowStockThreshold
    }))
    .filter((entry) => entry.available <= entry.threshold)
    .sort((a, b) => a.available - b.available)
}

/** True when the plan can be bought right now: active, active product, and stock if it needs any. */
export async function isPlanPurchasable(prisma: PrismaClient, planId: string): Promise<boolean> {
  const plan = await prisma.plan.findUnique({
    where: { id: planId },
    select: {
      isActive: true,
      product: { select: { isActive: true, deliveryType: true, externalConfig: true } }
    }
  })

  if (!plan || !plan.isActive || !plan.product.isActive) return false
  if (!isPoolBacked(plan.product.deliveryType, plan.product.externalConfig)) return true

  return (await countAvailable(prisma, planId)) > 0
}
