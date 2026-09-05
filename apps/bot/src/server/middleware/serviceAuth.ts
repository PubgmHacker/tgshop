import type { FastifyRequest, FastifyReply } from 'fastify'
import { safeEqual } from '@tgshop/core'
import { env } from '../../config/env.js'
import { toApiErrorBody } from '../../lib/httpErrors.js'
import { resolveLocale } from '../../i18n/index.js'

/** Guards /internal/* routes with a bearer SERVICE_TOKEN shared between backend services. */
export async function requireServiceToken(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization
  const locale = resolveLocale(req.headers['accept-language'])
  if (!header?.startsWith('Bearer ')) {
    await reply.code(401).send(toApiErrorBody('UNAUTHORIZED', locale, 'api.errors.unauthorized'))
    return
  }
  const token = header.slice('Bearer '.length)
  if (!safeEqual(token, env.SERVICE_TOKEN)) {
    await reply.code(401).send(toApiErrorBody('UNAUTHORIZED', locale, 'api.errors.unauthorized'))
  }
}
