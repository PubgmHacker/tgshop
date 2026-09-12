import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma, StockStatus } from '@tgshop/db'
import { isPoolBacked } from '@tgshop/core'
import { encryptStockPayload } from '../../../../domain/orders.js'
import { conflict, notFound, sendError } from '../../../../lib/httpErrors.js'
import { requestLocale } from '../context.js'
import { writeAdminAudit } from './shared.js'

// ─────────────────────────────────────────────────────────────────────────────
// GET    /api/admin/plans/:planId/stock — counts + recent items (never payloads)
// POST   /api/admin/plans/:planId/stock — bulk add lines, encrypted per line
// DELETE /api/admin/stock/:itemId       — remove an AVAILABLE item
//
// Payloads are write-only through this API: they are AES-GCM encrypted on the
// way in and NEVER decrypted back out. A delivered secret belongs only to the
// buyer's /api/orders/:id; an admin who mistyped a line deletes and re-adds it.
// ─────────────────────────────────────────────────────────────────────────────

const planParamsSchema = z.object({ planId: z.string().min(1).max(64) })
const itemParamsSchema = z.object({ itemId: z.string().min(1).max(64) })

const addStockSchema = z.object({
  lines: z
    .array(z.string().trim().min(1).max(2000))
    .min(1)
    .max(500)
})

export function registerAdminStockRoutes(app: FastifyInstance): void {
  app.get('/api/admin/plans/:planId/stock', async (req, reply) => {
    try {
      const { planId } = planParamsSchema.parse(req.params)

      const plan = await prisma.plan.findUnique({
        where: { id: planId },
        select: {
          id: true,
          title: true,
          lowStockThreshold: true,
          product: { select: { id: true, title: true, deliveryType: true, externalConfig: true } }
        }
      })
      if (!plan) throw notFound('api.errors.plan_not_found')

      const [groups, recent] = await Promise.all([
        prisma.stockItem.groupBy({ by: ['status'], where: { planId }, _count: { _all: true } }),
        prisma.stockItem.findMany({
          where: { planId },
          orderBy: { createdAt: 'desc' },
          take: 30,
          select: { id: true, status: true, orderId: true, createdAt: true }
        })
      ])

      const counts = { available: 0, reserved: 0, sold: 0 }
      for (const group of groups) {
        if (group.status === StockStatus.AVAILABLE) counts.available = group._count._all
        else if (group.status === StockStatus.RESERVED) counts.reserved = group._count._all
        else counts.sold = group._count._all
      }

      return {
        plan: {
          id: plan.id,
          title: plan.title,
          lowStockThreshold: plan.lowStockThreshold,
          productId: plan.product.id,
          productTitle: plan.product.title,
          deliveryType: plan.product.deliveryType,
          usesStock: isPoolBacked(plan.product.deliveryType, plan.product.externalConfig)
        },
        counts,
        recent: recent.map((item) => ({
          id: item.id,
          status: item.status,
          orderId: item.orderId,
          createdAt: item.createdAt.toISOString()
        }))
      }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })

  app.post('/api/admin/plans/:planId/stock', async (req, reply) => {
    try {
      const { planId } = planParamsSchema.parse(req.params)
      const body = addStockSchema.parse(req.body)

      const plan = await prisma.plan.findUnique({ where: { id: planId }, select: { id: true } })
      if (!plan) throw notFound('api.errors.plan_not_found')

      // One encrypt() per line — each ciphertext gets its own IV.
      const created = await prisma.stockItem.createMany({
        data: body.lines.map((line) => ({
          planId,
          payloadEnc: encryptStockPayload(line),
          status: StockStatus.AVAILABLE
        }))
      })

      await writeAdminAudit(req, 'stock.add', 'Plan', planId, { added: created.count })
      reply.code(201)
      return { planId, added: created.count }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })

  app.delete('/api/admin/stock/:itemId', async (req, reply) => {
    try {
      const { itemId } = itemParamsSchema.parse(req.params)

      // Delete-if-still-available in one statement so a concurrent reservation
      // cannot slip between a check and the delete.
      const deleted = await prisma.stockItem.deleteMany({
        where: { id: itemId, status: StockStatus.AVAILABLE }
      })
      if (deleted.count === 0) {
        const item = await prisma.stockItem.findUnique({ where: { id: itemId }, select: { id: true } })
        if (!item) throw notFound()
        // Row exists but is RESERVED or SOLD — it belongs to an order now.
        throw conflict('api.errors.in_use')
      }

      await writeAdminAudit(req, 'stock.delete', 'StockItem', itemId)
      return { itemId, deleted: true }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })
}
