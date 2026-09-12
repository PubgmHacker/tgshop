import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma, PostSource, PostStatus, Prisma, type BroadcastPost } from '@tgshop/db'
import { countSegment, parseSegment, SEGMENTS, FEATURED_PRODUCT_SLUG, mirasimAnnouncement, mirasimProductLink } from '@tgshop/core'
import { env } from '../../../../config/env.js'
import {
  createPost,
  isKnownSegment,
  publishPost,
  getPostById,
  removeQueuedBroadcast,
  KNOWN_SEGMENTS
} from '../../../../domain/content.js'
import { badRequest, conflict, notFound, sendError } from '../../../../lib/httpErrors.js'
import { logger } from '../../../../lib/logger.js'
import { requestLocale } from '../context.js'
import { prismaErrorCode, writeAdminAudit } from './shared.js'

// ─────────────────────────────────────────────────────────────────────────────
// Broadcast management for the Admin Mini App.
//
// Saving a message never sends it. The explicit `send` action is the safety
// gate; when a scheduledAt is present it queues a delayed BullMQ job. This is
// intentionally the same lifecycle as the desktop admin panel:
// DRAFT/SCHEDULED → QUEUED → SENDING → SENT.
// ─────────────────────────────────────────────────────────────────────────────

const idParamsSchema = z.object({ id: z.string().min(1).max(64) })

const segmentSchema = z
  .string()
  .trim()
  .refine((value) => isKnownSegment(value), 'unknown segment')

const writeBodySchema = z.object({
  text: z.string().trim().min(1).max(4096),
  mediaUrl: z.string().trim().url().max(2048).nullish(),
  segment: segmentSchema.nullish(),
  scheduledAt: z.string().datetime({ offset: true }).nullish(),
  /** Create-and-queue convenience for the compose form. */
  queue: z.boolean().default(false)
})

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  locale: z.enum(['ru', 'en']).default('ru')
})

function toPostDto(post: BroadcastPost): Record<string, unknown> {
  return {
    id: post.id,
    status: post.status,
    source: post.source,
    text: post.text,
    segment: post.segment,
    mediaUrl: post.mediaUrl,
    scheduledAt: post.scheduledAt?.toISOString() ?? null,
    sentAt: post.sentAt?.toISOString() ?? null,
    statsJson: post.statsJson ?? null,
    createdAt: post.createdAt.toISOString()
  }
}

function toDate(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null
}

function assertFutureSchedule(scheduledAt: Date | null, queue: boolean): void {
  if (scheduledAt && scheduledAt.getTime() <= Date.now() && !queue) {
    throw badRequest('api.errors.broadcast_schedule_past')
  }
}

function mapWriteError(err: unknown): unknown {
  const code = prismaErrorCode(err)
  if (code === 'P2025') return notFound('api.errors.post_not_found')
  return err
}

async function writeAuditSafely(
  req: Parameters<typeof writeAdminAudit>[0],
  action: string,
  id: string,
  diff?: Prisma.InputJsonValue
): Promise<void> {
  // The post/queue operation is the source of truth. A transient audit insert
  // failure must not make the UI retry a message-bearing mutation.
  await writeAdminAudit(req, action, 'BroadcastPost', id, diff).catch((err) => {
    logger.error({ err, postId: id, action }, 'broadcast audit write failed')
  })
}

export function registerAdminBroadcastRoutes(app: FastifyInstance): void {
  app.get('/api/admin/broadcasts', async (req, reply) => {
    try {
      const query = listQuerySchema.parse(req.query)
      const [posts, segments, featured] = await Promise.all([
        prisma.broadcastPost.findMany({ orderBy: { createdAt: 'desc' }, take: query.limit }),
        Promise.all(
          SEGMENTS.map(async (segment) => ({
            value: segment,
            count: await countSegment(prisma, segment)
          }))
        ),
        prisma.product.findFirst({ where: { slug: FEATURED_PRODUCT_SLUG, isActive: true, category: { isActive: true } }, select: { id: true } })
      ])

      return {
        posts: posts.map(toPostDto),
        segments,
        templates: featured ? [{
          id: 'mirasim-launch',
          title: 'Mirasim Pro',
          text: mirasimAnnouncement(mirasimProductLink(env.MINIAPP_URL, env.BOT_USERNAME), query.locale)
        }] : []
      }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })

  app.post('/api/admin/broadcasts', async (req, reply) => {
    try {
      const body = writeBodySchema.parse(req.body)
      const scheduledAt = toDate(body.scheduledAt)
      assertFutureSchedule(scheduledAt, body.queue)

      const post = await createPost({
        text: body.text,
        mediaUrl: body.mediaUrl ?? null,
        segment: body.segment ?? null,
        scheduledAt,
        source: PostSource.MANUAL
      })

      const queued = body.queue ? await publishPost(post.id) : post
      await writeAuditSafely(req, body.queue ? 'broadcast.send' : 'broadcast.create', post.id, {
        segment: body.segment ?? null,
        scheduledAt: scheduledAt?.toISOString() ?? null,
        queued: body.queue
      })

      reply.code(201)
      return { post: toPostDto(queued) }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })

  app.patch('/api/admin/broadcasts/:id', async (req, reply) => {
    try {
      const { id } = idParamsSchema.parse(req.params)
      const body = writeBodySchema.omit({ queue: true }).parse(req.body)
      const existing = await getPostById(id)
      if (!existing) throw notFound('api.errors.post_not_found')
      if (existing.status === PostStatus.SENDING || existing.status === PostStatus.SENT) {
        throw conflict('api.errors.broadcast_locked')
      }

      const scheduledAt = toDate(body.scheduledAt)
      assertFutureSchedule(scheduledAt, false)

      // A queued delayed job must be removed before its text is changed. If it
      // is already active, BullMQ refuses removal and the row stays untouched.
      if (existing.status === PostStatus.QUEUED) await removeQueuedBroadcast(id)

      const post = await prisma.broadcastPost
        .update({
          where: { id },
          data: {
            text: body.text,
            mediaUrl: body.mediaUrl ?? null,
            segment: body.segment ?? null,
            scheduledAt,
            status: scheduledAt ? PostStatus.SCHEDULED : PostStatus.DRAFT,
            sentAt: null,
            statsJson: Prisma.DbNull,
            source: PostSource.MANUAL
          }
        })
        .catch((err) => {
          throw mapWriteError(err)
        })

      await writeAuditSafely(req, 'broadcast.update', id, {
        segment: body.segment ?? null,
        scheduledAt: scheduledAt?.toISOString() ?? null
      })
      return { post: toPostDto(post) }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })

  app.post('/api/admin/broadcasts/:id/send', async (req, reply) => {
    try {
      const { id } = idParamsSchema.parse(req.params)
      const existing = await getPostById(id)
      if (!existing) throw notFound('api.errors.post_not_found')
      const parsedSegment = parseSegment(existing.segment)
      if (!parsedSegment) {
        throw badRequest('api.errors.unknown_segment', { segments: KNOWN_SEGMENTS.join(', ') })
      }

      const post = await publishPost(id)
      await writeAuditSafely(req, 'broadcast.send', id, {
        segment: parsedSegment,
        scheduledAt: post.scheduledAt?.toISOString() ?? null
      })
      return { post: toPostDto(post) }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })

  app.post('/api/admin/broadcasts/:id/cancel', async (req, reply) => {
    try {
      const { id } = idParamsSchema.parse(req.params)
      const existing = await getPostById(id)
      if (!existing) throw notFound('api.errors.post_not_found')
      if (existing.status !== PostStatus.QUEUED) {
        throw conflict('api.errors.broadcast_not_cancellable')
      }

      // Disarm the row first. The worker claims only QUEUED rows, so this
      // conditional write closes the race between a cancel tap and a delayed
      // job becoming runnable.
      const disarmed = await prisma.broadcastPost.updateMany({
        where: { id, status: PostStatus.QUEUED },
        data: { status: PostStatus.CANCELLED }
      })
      if (disarmed.count === 0) throw conflict('api.errors.broadcast_not_cancellable')
      await removeQueuedBroadcast(id)
      const post = await prisma.broadcastPost.findUniqueOrThrow({ where: { id } })
      await writeAuditSafely(req, 'broadcast.cancel', id)
      return { post: toPostDto(post) }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })

  app.delete('/api/admin/broadcasts/:id', async (req, reply) => {
    try {
      const { id } = idParamsSchema.parse(req.params)
      const existing = await getPostById(id)
      if (!existing) throw notFound('api.errors.post_not_found')
      if (existing.status === PostStatus.SENDING || existing.status === PostStatus.SENT) {
        throw conflict('api.errors.broadcast_locked')
      }
      if (existing.status === PostStatus.QUEUED) await removeQueuedBroadcast(id)
      await prisma.broadcastPost.delete({ where: { id } }).catch((err) => {
        throw mapWriteError(err)
      })
      await writeAuditSafely(req, 'broadcast.delete', id)
      return { id, deleted: true }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })
}
