import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { PaymentProvider } from '@tgshop/db'
import { enqueueReconcile, isReconcilableProvider } from '../../../domain/reconcile.js'
import { badRequest, sendError } from '../../../lib/httpErrors.js'
import { internalLocale } from './context.js'

// ─────────────────────────────────────────────────────────────────────────────
// POST /internal/reconcile — trigger one on-demand reconciliation pass
// (docs/AGENT_PLAN.md capability 3).
//
// This endpoint enqueues the worker's existing sweep rather than reconciling in
// the request: the sweep owns provider API access, retry policy and the DLQ, and
// an HTTP request that queried a provider inline would time out exactly when
// things are bad enough for someone to want a manual pass.
// ─────────────────────────────────────────────────────────────────────────────

const reconcileBodySchema = z.object({
  provider: z.nativeEnum(PaymentProvider),
  /** Advisory: the current sweeps re-check every pending row regardless of window. 1 minute .. 7 days. */
  sinceMinutes: z.number().int().min(1).max(10_080).nullish()
})

export function registerReconcileRoutes(app: FastifyInstance): void {
  app.post('/internal/reconcile', async (req, reply) => {
    try {
      const body = reconcileBodySchema.parse(req.body)

      if (!isReconcilableProvider(body.provider)) {
        // BALANCE is our own ledger and STARS settle synchronously inside
        // Telegram — neither has a provider-side record to disagree with.
        throw badRequest('api.errors.reconcile_unsupported', { provider: body.provider })
      }

      const enqueued = await enqueueReconcile(body.provider, body.sinceMinutes ?? null)

      reply.code(202)
      return {
        enqueued: true,
        provider: body.provider,
        queue: enqueued.queue,
        jobId: enqueued.jobId
      }
    } catch (err) {
      await sendError(reply, err, internalLocale())
      return
    }
  })
}
