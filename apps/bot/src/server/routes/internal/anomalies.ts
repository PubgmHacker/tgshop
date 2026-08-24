import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma, type Prisma } from '@tgshop/db'
import { badRequest, sendError } from '../../../lib/httpErrors.js'
import { internalLocale } from './context.js'

// ─────────────────────────────────────────────────────────────────────────────
// POST /internal/anomalies — record an anomaly flag (docs/AGENT_PLAN.md
// capability 4).
//
// Purely additive: it writes one AuditLog row with actorType="agent" and never
// mutates order/payment/stock state, so a wrong flag costs an admin a glance,
// not money. Flags land in the same audit timeline as human actions, which is
// what keeps "what the agent noticed" and "what a human did about it" in one
// auditable place (docs/ADMIN.md).
// ─────────────────────────────────────────────────────────────────────────────

export const ANOMALY_SEVERITIES = ['info', 'warning', 'high', 'critical'] as const

/** Hard cap on serialized evidence. An audit row is a pointer to the problem, not a data dump. */
const MAX_EVIDENCE_BYTES = 16_384

const anomalyBodySchema = z.object({
  severity: z.enum(ANOMALY_SEVERITIES),
  /** Short machine-friendly class, e.g. "payments", "stock", "orders". */
  category: z.string().min(1).max(64),
  summary: z.string().min(1).max(2_000),
  relatedEntity: z
    .object({
      type: z.string().min(1).max(64),
      id: z.string().min(1).max(128)
    })
    .nullish(),
  /** Arbitrary JSON the flagger wants preserved (event ids, amounts, tx hashes). */
  evidence: z.unknown().nullish(),
  /** Who is flagging; defaults to the anonymous service identity. */
  source: z.string().min(1).max(64).default('internal-api')
})

export function registerAnomalyRoutes(app: FastifyInstance): void {
  app.post('/internal/anomalies', async (req, reply) => {
    try {
      const body = anomalyBodySchema.parse(req.body)

      const evidence = body.evidence ?? null
      if (evidence !== null && JSON.stringify(evidence).length > MAX_EVIDENCE_BYTES) {
        throw badRequest('api.errors.anomaly_evidence_too_large', {
          maxBytes: MAX_EVIDENCE_BYTES
        })
      }

      const row = await prisma.auditLog.create({
        data: {
          actorType: 'agent',
          actorId: body.source,
          action: 'anomaly.flagged',
          entity: body.relatedEntity?.type ?? 'System',
          entityId: body.relatedEntity?.id ?? 'n/a',
          diff: {
            severity: body.severity,
            category: body.category,
            summary: body.summary,
            evidence
          } as Prisma.InputJsonValue
        }
      })

      reply.code(201)
      return {
        id: row.id,
        severity: body.severity,
        category: body.category,
        createdAt: row.createdAt.toISOString()
      }
    } catch (err) {
      await sendError(reply, err, internalLocale())
      return
    }
  })
}
