import type { FastifyInstance } from 'fastify'
import { prisma } from '@tgshop/db'
import { countAvailableForPlans, getLowStockPlans, isPoolBacked } from '../../../domain/stock.js'
import { sendError } from '../../../lib/httpErrors.js'
import { internalLocale } from './context.js'

// ─────────────────────────────────────────────────────────────────────────────
// GET /internal/stock     — stock level per active plan, with low-stock flags.
// GET /internal/stock/low — only the plans at or below their threshold
//                           (the shape docs/AGENT_PLAN.md + bruno expect).
// ─────────────────────────────────────────────────────────────────────────────

export function registerStockRoutes(app: FastifyInstance): void {
  app.get('/internal/stock', async (_req, reply) => {
    try {
      const plans = await prisma.plan.findMany({
        where: { isActive: true, product: { isActive: true } },
        orderBy: [{ productId: 'asc' }, { sortOrder: 'asc' }],
        include: { product: { include: { category: true } } }
      })

      const counts = await countAvailableForPlans(plans.map((plan) => plan.id))

      const items = plans.map((plan) => {
        const available = counts.get(plan.id) ?? 0
        const poolBacked = isPoolBacked(plan.product.deliveryType, plan.product.externalConfig)
        return {
          planId: plan.id,
          planTitle: plan.title,
          productId: plan.product.id,
          productTitle: plan.product.title,
          productSlug: plan.product.slug,
          categoryTitle: plan.product.category.title,
          categorySlug: plan.product.category.slug,
          deliveryType: plan.product.deliveryType,
          priceCents: plan.priceCents,
          available,
          lowStockThreshold: plan.lowStockThreshold,
          // Non-pool products are fulfilled out of band, so they are never
          // "out of stock" locally and never raise a low-stock flag.
          isLowStock: poolBacked && available <= plan.lowStockThreshold,
          isOutOfStock: poolBacked && available === 0
        }
      })

      return {
        items,
        summary: {
          plans: items.length,
          lowStock: items.filter((i) => i.isLowStock).length,
          outOfStock: items.filter((i) => i.isOutOfStock).length,
          totalAvailable: items.reduce((sum, i) => sum + i.available, 0)
        }
      }
    } catch (err) {
      await sendError(reply, err, internalLocale())
      return
    }
  })

  app.get('/internal/stock/low', async (_req, reply) => {
    try {
      return { plans: await getLowStockPlans() }
    } catch (err) {
      await sendError(reply, err, internalLocale())
      return
    }
  })
}
