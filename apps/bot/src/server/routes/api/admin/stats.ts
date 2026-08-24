import type { FastifyInstance } from 'fastify'
import {
  prisma,
  DeliveryType,
  LedgerType,
  OrderStatus,
  StockStatus,
  type Prisma
} from '@tgshop/db'
import { sendError } from '../../../../lib/httpErrors.js'
import { requestLocale } from '../context.js'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/stats — the dashboard aggregate.
//
// Revenue is reported as PAID GROSS (orders with paidAt set, whatever happened
// to them later) alongside REFUNDED (REFUND ledger credits in the window), so
// the two numbers never silently disagree with the ledger. "Net" is a display
// concern the client derives as gross − refunded.
// ─────────────────────────────────────────────────────────────────────────────

const STOCK_CONSUMING: DeliveryType[] = [DeliveryType.STOCK_POOL, DeliveryType.UNIQUE_CODE]
const REFUND_REQUESTED_ACTION = 'order.refund_requested'

interface RevenueWindow {
  grossCents: number
  refundedCents: number
  paidOrders: number
}

async function revenueWindow(since: Date | null): Promise<RevenueWindow> {
  const paidWhere: Prisma.OrderWhereInput = { paidAt: since ? { gte: since } : { not: null } }
  const refundWhere: Prisma.BalanceTransactionWhereInput = {
    type: LedgerType.REFUND,
    ...(since ? { createdAt: { gte: since } } : {})
  }
  const [paid, refunded] = await Promise.all([
    prisma.order.aggregate({ where: paidWhere, _sum: { amountCents: true }, _count: { _all: true } }),
    prisma.balanceTransaction.aggregate({ where: refundWhere, _sum: { amountCents: true } })
  ])
  return {
    grossCents: paid._sum.amountCents ?? 0,
    refundedCents: refunded._sum.amountCents ?? 0,
    paidOrders: paid._count._all
  }
}

export function registerAdminStatsRoutes(app: FastifyInstance): void {
  app.get('/api/admin/stats', async (req, reply) => {
    try {
      const now = new Date()
      const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
      const d7 = new Date(now.getTime() - 7 * 86_400_000)
      const d30 = new Date(now.getTime() - 30 * 86_400_000)

      const [
        today,
        last7d,
        last30d,
        total,
        statusGroups,
        usersTotal,
        usersToday,
        usersBlocked,
        stockPlans,
        availableGroups,
        refundRequests,
        recentOrders
      ] = await Promise.all([
        revenueWindow(dayStart),
        revenueWindow(d7),
        revenueWindow(d30),
        revenueWindow(null),
        prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
        prisma.user.count(),
        prisma.user.count({ where: { createdAt: { gte: dayStart } } }),
        prisma.user.count({ where: { isBlocked: true } }),
        prisma.plan.findMany({
          where: {
            isActive: true,
            product: { isActive: true, deliveryType: { in: STOCK_CONSUMING } }
          },
          select: {
            id: true,
            title: true,
            lowStockThreshold: true,
            product: { select: { id: true, title: true } }
          }
        }),
        prisma.stockItem.groupBy({
          by: ['planId'],
          where: { status: StockStatus.AVAILABLE },
          _count: { _all: true }
        }),
        prisma.auditLog.findMany({
          where: { action: REFUND_REQUESTED_ACTION },
          orderBy: { createdAt: 'desc' },
          take: 30
        }),
        prisma.order.findMany({
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: {
            user: { select: { tgId: true, username: true, firstName: true } },
            plan: { select: { title: true, product: { select: { title: true } } } }
          }
        })
      ])

      const availableByPlan = new Map(availableGroups.map((g) => [g.planId, g._count._all]))
      const lowStock = stockPlans
        .map((plan) => ({
          planId: plan.id,
          planTitle: plan.title,
          productId: plan.product.id,
          productTitle: plan.product.title,
          availableCount: availableByPlan.get(plan.id) ?? 0,
          lowStockThreshold: plan.lowStockThreshold
        }))
        .filter((p) => p.availableCount <= p.lowStockThreshold)
        .sort((a, b) => a.availableCount - b.availableCount)
        .slice(0, 20)

      // A refund request is "pending" until the order actually has a REFUND
      // credit (or REFUNDED status): once refunded it drops off the list, no
      // matter which surface (admin, agent, auto) executed the refund.
      const requestedOrderIds = [...new Set(refundRequests.map((r) => r.entityId))]
      const [refundedRows, requestedOrders] = await Promise.all([
        prisma.balanceTransaction.findMany({
          where: { orderId: { in: requestedOrderIds }, type: LedgerType.REFUND },
          select: { orderId: true }
        }),
        prisma.order.findMany({
          where: { id: { in: requestedOrderIds } },
          select: { id: true, status: true, amountCents: true }
        })
      ])
      const refundedSet = new Set(refundedRows.map((r) => r.orderId))
      const orderById = new Map(requestedOrders.map((o) => [o.id, o]))
      const seen = new Set<string>()
      const pendingRefunds = refundRequests
        .filter((r) => {
          if (seen.has(r.entityId)) return false
          seen.add(r.entityId)
          const order = orderById.get(r.entityId)
          return order !== undefined && order.status !== OrderStatus.REFUNDED && !refundedSet.has(r.entityId)
        })
        .map((r) => {
          const diff = (r.diff ?? {}) as { reason?: unknown }
          return {
            orderId: r.entityId,
            amountCents: orderById.get(r.entityId)?.amountCents ?? 0,
            reason: typeof diff.reason === 'string' ? diff.reason : '',
            requestedBy: r.actorId,
            requestedAt: r.createdAt.toISOString()
          }
        })
        .slice(0, 10)

      const ordersByStatus = Object.fromEntries(statusGroups.map((g) => [g.status, g._count._all]))

      return {
        revenue: { today, last7d, last30d, total },
        ordersByStatus,
        users: { total: usersTotal, newToday: usersToday, blocked: usersBlocked },
        lowStock,
        pendingRefunds,
        recentOrders: recentOrders.map((order) => ({
          id: order.id,
          status: order.status,
          provider: order.provider,
          amountCents: order.amountCents,
          productTitle: order.plan.product.title,
          planTitle: order.plan.title,
          user: {
            tgId: order.user.tgId.toString(),
            username: order.user.username,
            firstName: order.user.firstName
          },
          createdAt: order.createdAt.toISOString()
        }))
      }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })
}
