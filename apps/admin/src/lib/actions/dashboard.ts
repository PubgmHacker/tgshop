'use server'

import { prisma, AdminRole, OrderStatus, PaymentProvider, StockStatus } from '@tgshop/db'
import { requireRole } from '../rbac'

export interface RevenuePoint {
  bucket: string
  revenueCents: number
  orders: number
}

export interface DashboardData {
  revenueByDay: RevenuePoint[]
  ordersByStatus: { status: OrderStatus; count: number }[]
  paymentSplit: { provider: PaymentProvider; count: number; revenueCents: number }[]
  topProducts: { productId: string; title: string; revenueCents: number; orders: number }[]
  stockLevels: { planId: string; planTitle: string; productTitle: string; available: number; threshold: number }[]
  totals: {
    revenueCents: number
    orders: number
    paidOrders: number
    conversionPercent: number
    arpuCents: number
  }
}

/**
 * Aggregates dashboard metrics for the last `days` days. Revenue counts only
 * orders whose status indicates money actually settled (PAID, DELIVERING,
 * DELIVERED) — never PENDING/FAILED/EXPIRED — since amountCents is fixed at
 * order creation and REFUNDED orders keep their original amountCents but are
 * excluded from revenue.
 */
export async function getDashboardDataAction(days = 30): Promise<DashboardData> {
  requireRole(AdminRole.SUPPORT)

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const settledStatuses: OrderStatus[] = [OrderStatus.PAID, OrderStatus.DELIVERING, OrderStatus.DELIVERED]

  const [settledOrders, allOrdersInRange, ordersByStatusRaw, paymentsRaw, stockGrouped, plans] = await Promise.all([
    prisma.order.findMany({
      where: { status: { in: settledStatuses }, createdAt: { gte: since } },
      select: { amountCents: true, createdAt: true, planId: true, provider: true }
    }),
    prisma.order.count({ where: { createdAt: { gte: since } } }),
    prisma.order.groupBy({ by: ['status'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.order.groupBy({
      by: ['provider'],
      where: { status: { in: settledStatuses }, createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { amountCents: true }
    }),
    prisma.stockItem.groupBy({ by: ['planId', 'status'], _count: { _all: true } }),
    prisma.plan.findMany({ include: { product: true } })
  ])

  const revenueByDayMap = new Map<string, { revenueCents: number; orders: number }>()
  for (const order of settledOrders) {
    const bucket = order.createdAt.toISOString().slice(0, 10)
    const existing = revenueByDayMap.get(bucket) ?? { revenueCents: 0, orders: 0 }
    existing.revenueCents += order.amountCents
    existing.orders += 1
    revenueByDayMap.set(bucket, existing)
  }
  const revenueByDay: RevenuePoint[] = Array.from(revenueByDayMap.entries())
    .map(([bucket, v]) => ({ bucket, ...v }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket))

  const productRevenue = new Map<string, { title: string; revenueCents: number; orders: number }>()
  const planToProduct = new Map(plans.map((p) => [p.id, { id: p.productId, title: p.product.title }]))
  for (const order of settledOrders) {
    const product = planToProduct.get(order.planId)
    if (!product) continue
    const existing = productRevenue.get(product.id) ?? { title: product.title, revenueCents: 0, orders: 0 }
    existing.revenueCents += order.amountCents
    existing.orders += 1
    productRevenue.set(product.id, existing)
  }
  const topProducts = Array.from(productRevenue.entries())
    .map(([productId, v]) => ({ productId, ...v }))
    .sort((a, b) => b.revenueCents - a.revenueCents)
    .slice(0, 10)

  const stockByPlan = new Map<string, number>()
  for (const row of stockGrouped) {
    if (row.status === StockStatus.AVAILABLE) {
      stockByPlan.set(row.planId, (stockByPlan.get(row.planId) ?? 0) + row._count._all)
    }
  }
  const stockLevels = plans
    .filter((plan) => plan.isActive)
    .map((plan) => ({
      planId: plan.id,
      planTitle: plan.title,
      productTitle: plan.product.title,
      available: stockByPlan.get(plan.id) ?? 0,
      threshold: plan.lowStockThreshold
    }))
    .sort((a, b) => a.available - b.available)

  const revenueCents = settledOrders.reduce((sum, o) => sum + o.amountCents, 0)
  const paidOrders = settledOrders.length
  const conversionPercent = allOrdersInRange > 0 ? Math.round((paidOrders / allOrdersInRange) * 10000) / 100 : 0
  const arpuCents = paidOrders > 0 ? Math.round(revenueCents / paidOrders) : 0

  return {
    revenueByDay,
    ordersByStatus: ordersByStatusRaw.map((r) => ({ status: r.status, count: r._count._all })),
    paymentSplit: paymentsRaw.map((r) => ({
      provider: r.provider,
      count: r._count._all,
      revenueCents: r._sum.amountCents ?? 0
    })),
    topProducts,
    stockLevels,
    totals: {
      revenueCents,
      orders: allOrdersInRange,
      paidOrders,
      conversionPercent,
      arpuCents
    }
  }
}
