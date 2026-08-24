import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { isAdminId } from '../../../../config/env.js'
import { forbidden, sendError } from '../../../../lib/httpErrors.js'
import { requestLocale } from '../context.js'
import { registerAdminStatsRoutes } from './stats.js'
import { registerAdminOrderRoutes } from './orders.js'
import { registerAdminCatalogRoutes } from './catalog.js'
import { registerAdminStockRoutes } from './stock.js'
import { registerAdminPromoRoutes } from './promos.js'
import { registerAdminUserRoutes } from './users.js'
import { registerAdminSettingsRoutes } from './settings.js'
import { registerAdminAuditRoutes } from './audit.js'

// ─────────────────────────────────────────────────────────────────────────────
// /api/admin/* — the Admin Mini App's API.
//
// Layered inside the JWT-authenticated scope, so requireJwtAuth has already
// verified the token and populated req.auth. Admin identity is the flat
// ADMIN_IDS env allowlist — the same source the bot's /admin command trusts —
// checked on EVERY request rather than baked into a token claim, so promoting
// or demoting an admin takes effect on their next call, not at token expiry.
// ─────────────────────────────────────────────────────────────────────────────

async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  let allowed = false
  const tgId = req.auth?.tgId
  if (tgId) {
    try {
      allowed = isAdminId(BigInt(tgId))
    } catch {
      allowed = false
    }
  }
  if (!allowed) {
    await sendError(reply, forbidden(), requestLocale(req))
  }
}

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  await app.register(async (admin: FastifyInstance) => {
    admin.addHook('onRequest', requireAdmin)

    registerAdminStatsRoutes(admin)
    registerAdminOrderRoutes(admin)
    registerAdminCatalogRoutes(admin)
    registerAdminStockRoutes(admin)
    registerAdminPromoRoutes(admin)
    registerAdminUserRoutes(admin)
    registerAdminSettingsRoutes(admin)
    registerAdminAuditRoutes(admin)
  })
}
