import type { FastifyRequest, FastifyReply } from 'fastify'
import { verifyMiniAppJwt, InitDataError } from '../auth.js'

declare module 'fastify' {
  interface FastifyRequest {
    auth?: { userId: string; tgId: string }
  }
}

/** Requires a valid `Authorization: Bearer <jwt>` issued by /api/auth/telegram. Never trust client-supplied userId. */
export async function requireJwtAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    await reply.code(401).send({ error: 'unauthorized', message: 'missing bearer token' })
    return
  }
  const token = header.slice('Bearer '.length)
  try {
    const payload = verifyMiniAppJwt(token)
    req.auth = { userId: payload.sub, tgId: payload.tgId }
  } catch (err) {
    const message = err instanceof InitDataError ? err.message : 'invalid token'
    await reply.code(401).send({ error: 'unauthorized', message })
  }
}
