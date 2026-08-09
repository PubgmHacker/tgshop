import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { PostSource, type BroadcastPost } from '@tgshop/db'
import { createPost, getPostById, isKnownSegment, publishPost, KNOWN_SEGMENTS } from '../../../domain/content.js'
import { badRequest, notFound, sendError } from '../../../lib/httpErrors.js'
import { internalLocale } from './context.js'

// ─────────────────────────────────────────────────────────────────────────────
// POST /internal/posts             — create a BroadcastPost (DRAFT, or
//                                    SCHEDULED when scheduledAt is set).
// POST /internal/posts/:id/publish — hand the post to the worker's broadcast
//                                    queue for fan-out.
//
// Agent-authored posts default to DRAFT so a human approves before anything
// reaches subscribers (docs/AGENT_PLAN.md safety gate).
// ─────────────────────────────────────────────────────────────────────────────

const createPostBodySchema = z.object({
  text: z.string().min(1).max(4096),
  channelId: z.string().min(1).max(128).nullish(),
  segment: z.string().min(1).max(64).nullish(),
  mediaUrl: z.string().url().max(2048).nullish(),
  scheduledAt: z.string().datetime().nullish(),
  source: z.nativeEnum(PostSource).default(PostSource.MANUAL)
})

const postIdParamSchema = z.object({
  id: z.string().min(1).max(64)
})

function toPostDto(post: BroadcastPost): Record<string, unknown> {
  return {
    id: post.id,
    status: post.status,
    source: post.source,
    text: post.text,
    channelId: post.channelId,
    segment: post.segment,
    mediaUrl: post.mediaUrl,
    scheduledAt: post.scheduledAt ? post.scheduledAt.toISOString() : null,
    sentAt: post.sentAt ? post.sentAt.toISOString() : null,
    statsJson: post.statsJson,
    createdAt: post.createdAt.toISOString()
  }
}

export function registerPostRoutes(app: FastifyInstance): void {
  const create = async (req: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    try {
      const body = createPostBodySchema.parse(req.body)

      // The worker treats an unknown segment as "no recipients" rather than
      // "everyone", so reject typos here instead of silently sending to nobody.
      if (body.segment && !isKnownSegment(body.segment)) {
        throw badRequest('api.errors.unknown_segment', { segments: KNOWN_SEGMENTS.join(', ') })
      }

      const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null

      const post = await createPost({
        text: body.text,
        channelId: body.channelId ?? null,
        segment: body.segment ?? null,
        mediaUrl: body.mediaUrl ?? null,
        scheduledAt,
        source: body.source
      })

      reply.code(201)
      return toPostDto(post)
    } catch (err) {
      await sendError(reply, err, internalLocale())
      return
    }
  }

  app.post('/internal/posts', create)
  // Alias matching docs/AGENT_PLAN.md and bruno/tgshop/internal-api/.
  app.post('/internal/broadcasts', create)

  app.post('/internal/posts/:id/publish', async (req, reply) => {
    try {
      const { id } = postIdParamSchema.parse(req.params)

      const existing = await getPostById(id)
      if (!existing) throw notFound('api.errors.post_not_found')

      const post = await publishPost(id)
      return toPostDto(post)
    } catch (err) {
      await sendError(reply, err, internalLocale())
      return
    }
  })
}
