import { prisma, OrderStatus } from '@tgshop/db'

// ─────────────────────────────────────────────────────────────────────────────
// Read-only analytics for /internal/stats and /internal/top-products.
//
// "Revenue" counts only orders that actually settled (PAID / DELIVERING /
// DELIVERED) and never PENDING or EXPIRED ones, so the number matches money
// the shop can recognize. REFUNDED orders are excluded from revenue and
// reported separately.
// ─────────────────────────────────────────────────────────────────────────────

export const REVENUE_STATUSES = [OrderStatus.PAID, OrderStatus.DELIVERING, OrderStatus.DELIVERED] as const

export interface RevenueBucket {
  /** ISO date (YYYY-MM-DD) for day buckets, ISO week start for week, YYYY-MM for month. */
  period: string
  revenueCents: number
  orders: number
}

export interface StatsSummary {
  revenue: {
    todayCents: number
    last7dCents: number
    last30dCents: number
    allTimeCents: number
  }
  byDay: RevenueBucket[]
  byWeek: RevenueBucket[]
  byMonth: RevenueBucket[]
  ordersByStatus: Record<string, number>
  users: {
    total: number
    payingUsers: number
    newLast7d: number
  }
  arpuCents: number
  arppuCents: number
  conversionPercent: number
  refundedCents: number
}

interface OrderRow {
  amountCents: number
  createdAt: Date
  userId: string
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function dayKey(date: Date): string {
  return startOfUtcDay(date).toISOString().slice(0, 10)
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

/** ISO-ish week bucket keyed by the Monday (UTC) that starts the week. */
function weekKey(date: Date): string {
  const day = startOfUtcDay(date)
  // getUTCDay(): 0=Sunday..6=Saturday; shift so Monday starts the week.
  const offset = (day.getUTCDay() + 6) % 7
  day.setUTCDate(day.getUTCDate() - offset)
  return day.toISOString().slice(0, 10)
}

function bucketize(rows: readonly OrderRow[], keyOf: (d: Date) => string): RevenueBucket[] {
  const buckets = new Map<string, RevenueBucket>()
  for (const row of rows) {
    const period = keyOf(row.createdAt)
    const existing = buckets.get(period)
    if (existing) {
      existing.revenueCents += row.amountCents
      existing.orders += 1
    } else {
      buckets.set(period, { period, revenueCents: row.amountCents, orders: 1 })
    }
  }
  return Array.from(buckets.values()).sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0))
}

function sumSince(rows: readonly OrderRow[], since: Date): number {
  let total = 0
  for (const row of rows) {
    if (row.createdAt.getTime() >= since.getTime()) total += row.amountCents
  }
  return total
}

/** Aggregate shop statistics. `days` bounds the day/week buckets returned. */
export async function getStats(days = 30): Promise<StatsSummary> {
  const now = new Date()
  const windowStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)

  const [settledRows, statusGroups, refundAgg, totalUsers, newUsers] = await Promise.all([
    prisma.order.findMany({
      where: { status: { in: [...REVENUE_STATUSES] } },
      select: { amountCents: true, createdAt: true, userId: true }
    }),
    prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.order.aggregate({ where: { status: OrderStatus.REFUNDED }, _sum: { amountCents: true } }),
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) } } })
  ])

  const allTimeCents = settledRows.reduce((sum, row) => sum + row.amountCents, 0)
  const windowRows = settledRows.filter((row) => row.createdAt.getTime() >= windowStart.getTime())

  const ordersByStatus: Record<string, number> = {}
  for (const status of Object.values(OrderStatus)) {
    ordersByStatus[status] = 0
  }
  for (const group of statusGroups) {
    ordersByStatus[group.status] = group._count._all
  }

  const payingUserIds = new Set(settledRows.map((row) => row.userId))
  const payingUsers = payingUserIds.size

  // ARPU spreads revenue over every registered user; ARPPU only over payers.
  const arpuCents = totalUsers > 0 ? Math.round(allTimeCents / totalUsers) : 0
  const arppuCents = payingUsers > 0 ? Math.round(allTimeCents / payingUsers) : 0
  const conversionPercent = totalUsers > 0 ? Number(((payingUsers / totalUsers) * 100).toFixed(2)) : 0

  return {
    revenue: {
      todayCents: sumSince(settledRows, startOfUtcDay(now)),
      last7dCents: sumSince(settledRows, new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)),
      last30dCents: sumSince(settledRows, new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)),
      allTimeCents
    },
    byDay: bucketize(windowRows, dayKey),
    byWeek: bucketize(windowRows, weekKey),
    byMonth: bucketize(settledRows, monthKey),
    ordersByStatus,
    users: { total: totalUsers, payingUsers, newLast7d: newUsers },
    arpuCents,
    arppuCents,
    conversionPercent,
    refundedCents: refundAgg._sum.amountCents ?? 0
  }
}

export interface TopProduct {
  productId: string
  productTitle: string
  productSlug: string
  categoryTitle: string
  unitsSold: number
  revenueCents: number
  orders: number
}

/** Best-selling products by settled revenue. */
export async function getTopProducts(limit = 10): Promise<TopProduct[]> {
  const orders = await prisma.order.findMany({
    where: { status: { in: [...REVENUE_STATUSES] } },
    select: {
      qty: true,
      amountCents: true,
      plan: { select: { product: { select: { id: true, title: true, slug: true, category: { select: { title: true } } } } } }
    }
  })

  const byProduct = new Map<string, TopProduct>()
  for (const order of orders) {
    const product = order.plan.product
    const existing = byProduct.get(product.id)
    if (existing) {
      existing.unitsSold += order.qty
      existing.revenueCents += order.amountCents
      existing.orders += 1
    } else {
      byProduct.set(product.id, {
        productId: product.id,
        productTitle: product.title,
        productSlug: product.slug,
        categoryTitle: product.category.title,
        unitsSold: order.qty,
        revenueCents: order.amountCents,
        orders: 1
      })
    }
  }

  return Array.from(byProduct.values())
    .sort((a, b) => b.revenueCents - a.revenueCents)
    .slice(0, limit)
}
