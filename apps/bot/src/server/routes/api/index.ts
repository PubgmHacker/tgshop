import type { FastifyInstance } from 'fastify'
import { requireJwtAuth } from '../../middleware/jwtAuth.js'
import { registerAuthRoutes } from './auth.js'
import { registerCatalogRoutes } from './catalog.js'
import { registerMeRoutes } from './me.js'
import { registerOrderRoutes } from './orders.js'
import { registerTopupRoutes } from './topup.js'

// ─────────────────────────────────────────────────────────────────────────────
// The Mini App API.
//
// /api/auth/telegram is the only public route. Everything else lives inside an
// encapsulated child scope carrying a single onRequest JWT hook, so a newly
// added route is authenticated by default rather than by remembering to opt in.
// ─────────────────────────────────────────────────────────────────────────────

export async function apiRoutes(app: FastifyInstance): Promise<void> {
  registerAuthRoutes(app)

  await app.register(async (authenticated: FastifyInstance) => {
    authenticated.addHook('onRequest', requireJwtAuth)

    registerCatalogRoutes(authenticated)
    registerMeRoutes(authenticated)
    registerOrderRoutes(authenticated)
    registerTopupRoutes(authenticated)
  })
}
