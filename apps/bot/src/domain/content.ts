import { prisma, PostStatus, PostSource } from '@tgshop/db'
import type { BroadcastPost } from '@tgshop/db'
import { Queue } from 'bullmq'
import { redis } from '../config/redis.js'
import { logger } from '../lib/logger.js'

// ─────────────────────────────────────────────────────────────────────────────
// BroadcastPost creation / scheduling / publishing.
//
// Publishing hands the post to apps/worker's `broadcast` queue, which owns the
// actual fan-out (rate limiting, 403 -> User.isBlocked, statsJson). The queue
// name, job name and jobId here MUST stay byte-identical to
// apps/worker/src/queues/broadcast.ts::enqueueBroadcast — a mismatch would
// silently enqueue jobs no worker consumes.
// ─────────────────────────────────────────────────────────────────────────────

const BROADCAST_QUEUE_NAME = 'broadcast'
const BROADCAST_JOB_NAME = 'send-post'

/** Segment codes apps/worker's broadcast worker knows how to resolve. */
export const KNOWN_SEGMENTS = ['all', 'active_subscribers', 'no_purchases'] as const
export type Segment = (typeof KNOWN_SEGMENTS)[number]

export function isKnownSegment(segment: string): segment is Segment {
  return (KNOWN_SEGMENTS as readonly string[]).includes(segment)
}

let broadcastQueue: Queue<{ postId: string }> | null = null

function getBroadcastQueue(): Queue<{ postId: string }> {
  if (!broadcastQueue) {
    // Producing jobs is non-blocking, so the shared ioredis client is safe to
    // reuse here (it is already configured with maxRetriesPerRequest: null,
    // which BullMQ requires). Only Workers need dedicated blocking connections.
    broadcastQueue = new Queue<{ postId: string }>(BROADCAST_QUEUE_NAME, { connection: redis })
  }
  return broadcastQueue
}

export interface CreatePostInput {
  text: string
  channelId?: string | null
  segment?: string | null
  mediaUrl?: string | null
  scheduledAt?: Date | null
  source?: PostSource
}

/**
 * Creates a BroadcastPost. Status is SCHEDULED when a `scheduledAt` is supplied,
 * otherwise DRAFT.
 *
 * An AGENT-authored post is DRAFT regardless of scheduledAt. The worker's sweep
 * arms SCHEDULED posts by itself, so letting an agent write SCHEDULED would hand
 * it a route to every customer with no human in the loop — exactly what the
 * docs/AGENT_PLAN.md safety gate exists to prevent. The requested time is kept
 * on the row; a human publishing the post is what arms it.
 */
export async function createPost(input: CreatePostInput): Promise<BroadcastPost> {
  const scheduledAt = input.scheduledAt ?? null
  const source = input.source ?? PostSource.MANUAL
  return prisma.broadcastPost.create({
    data: {
      text: input.text,
      channelId: input.channelId ?? null,
      segment: input.segment ?? null,
      mediaUrl: input.mediaUrl ?? null,
      scheduledAt,
      source,
      status: scheduledAt && source !== PostSource.AGENT ? PostStatus.SCHEDULED : PostStatus.DRAFT
    }
  })
}

/** Moves a post to SCHEDULED for a future send time. */
export async function schedulePost(postId: string, scheduledAt: Date): Promise<BroadcastPost> {
  return prisma.broadcastPost.update({
    where: { id: postId },
    data: { scheduledAt, status: PostStatus.SCHEDULED }
  })
}

export class PostStateError extends Error {
  public readonly status: PostStatus

  constructor(status: PostStatus) {
    super(`Broadcast post cannot be published from status ${status}`)
    this.name = 'PostStateError'
    this.status = status
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/**
 * Publishes a post: flips it to QUEUED and hands it to the worker's queue,
 * holding the job until `scheduledAt` when that is still in the future.
 *
 * QUEUED rather than SCHEDULED or SENDING, because those two mean different
 * things now: SCHEDULED is "saved for a time, not armed", QUEUED is "armed, not
 * a single message sent yet, still cancellable", and SENDING is written by the
 * worker once it actually starts fanning out.
 *
 * Idempotent on postId — BullMQ dedupes on the `broadcast-<postId>` jobId, and
 * the worker's claim refuses posts already SENT or CANCELLED.
 */
export async function publishPost(postId: string): Promise<BroadcastPost> {
  const post = await prisma.broadcastPost.findUnique({ where: { id: postId } })
  if (!post) return Promise.reject(new PostStateError(PostStatus.FAILED))

  if (
    post.status === PostStatus.QUEUED ||
    post.status === PostStatus.SENDING ||
    post.status === PostStatus.SENT
  ) {
    // Already armed, in flight, or done — return as-is rather than double-sending.
    return post
  }

  const scheduledAt = post.scheduledAt ?? new Date()
  const updated = await prisma.broadcastPost.update({
    where: { id: postId },
    data: { status: PostStatus.QUEUED, scheduledAt }
  })

  await enqueueBroadcast(postId, Math.max(0, scheduledAt.getTime() - Date.now()))
  return updated
}

/** Adds the worker's `send-post` job, mirroring apps/worker's enqueueBroadcast. */
export async function enqueueBroadcast(postId: string, delayMs = 0): Promise<void> {
  const queue = getBroadcastQueue()
  await queue.add(
    BROADCAST_JOB_NAME,
    { postId },
    {
      jobId: `broadcast-${postId}`,
      delay: delayMs,
      attempts: 5,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: { count: 1_000, age: 24 * 60 * 60 },
      removeOnFail: { count: 5_000, age: 7 * 24 * 60 * 60 }
    }
  )
}

export async function getPostById(postId: string): Promise<BroadcastPost | null> {
  return prisma.broadcastPost.findUnique({ where: { id: postId } })
}

export async function closeBroadcastQueue(): Promise<void> {
  if (!broadcastQueue) return
  try {
    await broadcastQueue.close()
  } catch (err) {
    logger.warn({ err }, 'failed to close broadcast queue cleanly')
  } finally {
    broadcastQueue = null
  }
}
