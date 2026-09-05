import type { FastifyRequest, FastifyReply } from 'fastify'
import { verifyMiniAppJwt } from '../auth.js'
import { toApiErrorBody } from '../../lib/httpErrors.js'
import { resolveLocale } from '../../i18n/index.js'

declare module 'fastify' {
  interface FastifyRequest {
    auth?: { userId: string; tgId: string }
  }
}

/** Requires a valid `Authorization: Bearer <jwt>` issued by /api/auth/telegram. Never trust client-supplied userId. */
export async function requireJwtAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization
  const locale = resolveLocale(req.headers['accept-language'])
  if (!header?.startsWith('Bearer ')) {
    await reply.code(401).send(toApiErrorBody('UNAUTHORIZED', locale, 'api.errors.unauthorized'))
    return
  }
  const token = header.slice('Bearer '.length)
  try {
    const payload = verifyMiniAppJwt(token)
    req.auth = { userId: payload.sub, tgId: payload.tgId }
  } catch (err) {
    // Parser details belong in server logs, not in an authentication oracle.
    void err
    await reply.code(401).send(toApiErrorBody('UNAUTHORIZED', locale, 'api.errors.unauthorized'))
  }
}
