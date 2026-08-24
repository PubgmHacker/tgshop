import type { FastifyInstance } from 'fastify'
import { requireServiceToken } from '../../middleware/serviceAuth.js'
import { registerStatsRoutes } from './stats.js'
import { registerStockRoutes } from './stock.js'
import { registerInternalOrderRoutes } from './orders.js'
import { registerPostRoutes } from './posts.js'
import { registerReconcileRoutes } from './reconcile.js'
import { registerAnomalyRoutes } from './anomalies.js'

// ─────────────────────────────────────────────────────────────────────────────
// The Phase-2 agent seam: service-to-service endpoints for the worker, admin
// tooling and LLM agents (docs/AGENT_PLAN.md).
//
// The whole group sits in one encapsulated scope behind a single SERVICE_TOKEN
// bearer hook, so no /internal route can ever be added unauthenticated.
// ─────────────────────────────────────────────────────────────────────────────

export async function internalRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', requireServiceToken)

  registerStatsRoutes(app)
  registerStockRoutes(app)
  registerInternalOrderRoutes(app)
  registerPostRoutes(app)
  registerReconcileRoutes(app)
  registerAnomalyRoutes(app)
}
