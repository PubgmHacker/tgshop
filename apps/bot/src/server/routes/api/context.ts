import type { FastifyRequest } from 'fastify'
import { resolveLocale, type Locale } from '../../../i18n/index.js'
import { HttpError } from '../../../lib/httpErrors.js'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers shared by the authenticated /api routes.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The authenticated user's internal id, taken from the verified JWT ONLY.
 * A client-supplied userId is never trusted anywhere in this API.
 */
export function requireUserId(req: FastifyRequest): string {
  const userId = req.auth?.userId
  if (!userId) {
    // requireJwtAuth runs as an onRequest hook and already replied 401; this
    // guard exists so a mis-wired route fails loudly instead of leaking data.
    throw new HttpError(401, 'UNAUTHORIZED', 'api.errors.unauthorized')
  }
  return userId
}

/** Best-effort caller locale for error messages, from the Accept-Language header. */
export function requestLocale(req: FastifyRequest): Locale {
  return resolveLocale(req.headers['accept-language'])
}
