import type { FastifyRequest, FastifyReply } from 'fastify'
import { safeEqual } from '@tgshop/core'
import { env } from '../../config/env.js'

/** Guards /internal/* routes with a bearer SERVICE_TOKEN shared between backend services. */
export async function requireServiceToken(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    await reply.code(401).send({ error: 'unauthorized', message: 'missing bearer token' })
    return
  }
  const token = header.slice('Bearer '.length)
  if (!safeEqual(token, env.SERVICE_TOKEN)) {
    await reply.code(401).send({ error: 'unauthorized', message: 'invalid service token' })
  }
}
