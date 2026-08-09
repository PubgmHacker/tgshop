import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getStats, getTopProducts } from '../../../domain/stats.js'
import { sendError } from '../../../lib/httpErrors.js'
import { internalLocale } from './context.js'

// ─────────────────────────────────────────────────────────────────────────────
// GET /internal/stats        — revenue by day/week/month, orders by status,
//                              ARPU/ARPPU, conversion.
// GET /internal/top-products — best sellers by settled revenue.
// ─────────────────────────────────────────────────────────────────────────────

const statsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30)
})

const topProductsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10)
})

export function registerStatsRoutes(app: FastifyInstance): void {
  app.get('/internal/stats', async (req, reply) => {
    try {
      const { days } = statsQuerySchema.parse(req.query)
      return await getStats(days)
    } catch (err) {
      await sendError(reply, err, internalLocale())
      return
    }
  })

  app.get('/internal/top-products', async (req, reply) => {
    try {
      const { limit } = topProductsQuerySchema.parse(req.query)
      return { products: await getTopProducts(limit) }
    } catch (err) {
      await sendError(reply, err, internalLocale())
      return
    }
  })
}
