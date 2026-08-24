import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma, type Prisma } from '@tgshop/db'
import { sendError } from '../../../../lib/httpErrors.js'
import { requestLocale } from '../context.js'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/audit — the write trail (admin actions, agent requests,
// system refunds), newest first, cursor-paginated. Read-only by design: audit
// rows are append-only evidence and no API deletes or edits them.
// ─────────────────────────────────────────────────────────────────────────────

const listQuerySchema = z.object({
  entity: z.string().trim().min(1).max(64).optional(),
  actorType: z.string().trim().min(1).max(32).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().min(1).max(64).optional()
})

export function registerAdminAuditRoutes(app: FastifyInstance): void {
  app.get('/api/admin/audit', async (req, reply) => {
    try {
      const query = listQuerySchema.parse(req.query)

      const where: Prisma.AuditLogWhereInput = {
        ...(query.entity ? { entity: query.entity } : {}),
        ...(query.actorType ? { actorType: query.actorType } : {})
      }

      const rows = await prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: query.limit,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {})
      })

      return {
        entries: rows.map((row) => ({
          id: row.id,
          actorType: row.actorType,
          actorId: row.actorId,
          action: row.action,
          entity: row.entity,
          entityId: row.entityId,
          diff: row.diff ?? null,
          createdAt: row.createdAt.toISOString()
        })),
        nextCursor: rows.length === query.limit ? (rows[rows.length - 1]?.id ?? null) : null
      }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })
}
