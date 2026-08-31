import type { Job } from 'bullmq'
import { prisma, PostStatus } from '@tgshop/db'
import { getSetting, parseSegment, resolveSegmentRecipients, type SegmentRecipient } from '@tgshop/core'
import { createWorker, QueueName, newCorrelationId, getQueue, upsertRepeatable } from '../queue.js'
import { jobLogger } from '../logger.js'
import { emitEvent } from '../events.js'
import { sendTelegramMessage, TelegramBlockedError, TelegramRateLimitError } from '../telegram.js'
import {
  enqueueBroadcast,
  broadcastJobId,
  BROADCAST_SWEEP_JOB_NAME,
  type BroadcastJobData
} from './broadcast.js'
import { getRedisConnection } from '../redis.js'

// ─────────────────────────────────────────────────────────────────────────────
// broadcast worker: sends BroadcastPost.text with an optional media attachment to
// every non-blocked User matching `segment`, at up to
// the configured messages/second globally, honoring 429
// retry_after by pausing the whole batch, and flagging User.isBlocked on 403.
// Writes final counts to BroadcastPost.statsJson and moves status to SENT
// (or FAILED if the post could not be sent to anyone).
//
// This queue also carries a periodic sweep (`broadcast-sweep`) to recover
// QUEUED posts whose delayed BullMQ job has gone missing after a Redis flush or
// eviction. SCHEDULED is intentionally an unarmed, reviewable state; only the
// explicit admin/bot publish action moves a post to QUEUED and makes delivery
// possible.
// ─────────────────────────────────────────────────────────────────────────────

const SWEEP_INTERVAL_MS = 60 * 1000 // minute-granularity is enough for a schedule the operator types by hand

interface BroadcastStats {
  total: number
  sent: number
  blocked: number
  failed: number
  startedAt: string
  finishedAt: string
}

export async function registerBroadcastRepeatables(): Promise<void> {
  await upsertRepeatable(QueueName.Broadcast, BROADCAST_SWEEP_JOB_NAME, SWEEP_INTERVAL_MS)
}

/**
 * Segment membership lives in @tgshop/core so the admin's recipient preview and
 * this worker's actual send can never disagree. An unrecognized code returns
 * null from parseSegment() and is treated as "no recipients" rather than
 * silently defaulting to "all" and spamming the entire user base.
 */
async function resolveSegmentUsers(segment: string | null): Promise<SegmentRecipient[] | null> {
  const parsed = parseSegment(segment)
  if (parsed === null) return null
  return resolveSegmentRecipients(prisma, parsed)
}

async function processBroadcast(job: Job<BroadcastJobData>): Promise<void> {
  const correlationId = newCorrelationId()
  const log = jobLogger(QueueName.Broadcast, job.id, correlationId)

  if (job.name === BROADCAST_SWEEP_JOB_NAME) {
    await sweepDuePosts(log)
    return
  }

  const { postId } = job.data
  if (!postId) {
    log.error({ jobName: job.name }, 'broadcast job: no postId, dropping')
    return
  }
  await sendPost(postId, log)
}

/**
 * Arms every post whose delivery is due but has no live queue job behind it.
 *
 * Deliberately re-checks Redis rather than trusting the row: QUEUED means "a job
 * was created for this post", and the point of the sweep is precisely the case
 * where that job no longer exists.
 */
async function sweepDuePosts(log: ReturnType<typeof jobLogger>): Promise<void> {
  const now = new Date()

  // Uses the @@index([status, scheduledAt]) on broadcast_posts.
  const due = await prisma.broadcastPost.findMany({
    where: { status: { in: [PostStatus.QUEUED, PostStatus.SENDING] } },
    select: { id: true, status: true, scheduledAt: true, statsJson: true }
  })

  let armed = 0
  for (const post of due) {
    try {
      // A process can die after claiming SENDING but before writing SENT/FAILED.
      // Recover only when BullMQ has no live job and the recorded start time is
      // old enough that it cannot be a healthy long-running fan-out.
      if (post.status === PostStatus.SENDING && !isStaleSending(post.statsJson, now)) continue
      if (await hasPendingJob(post.id)) continue

      if (post.status === PostStatus.SENDING) {
        const recovered = await prisma.broadcastPost.updateMany({
          where: { id: post.id, status: PostStatus.SENDING },
          data: { status: PostStatus.QUEUED }
        })
        if (recovered.count === 0) continue
      }

      // A QUEUED post still in the future keeps its delay; an immediate post
      // has no scheduledAt and is armed with zero delay.
      const delayMs =
        post.scheduledAt && post.scheduledAt.getTime() > now.getTime()
          ? post.scheduledAt.getTime() - now.getTime()
          : 0

      await enqueueBroadcast(post.id, delayMs)
      armed += 1
      log.info({ postId: post.id, previousStatus: post.status, delayMs }, 'broadcast sweep: armed post')
    } catch (err) {
      log.error({ err, postId: post.id }, 'broadcast sweep: failed to arm post')
    }
  }

  if (armed > 0) log.info({ armed, scanned: due.length }, 'broadcast sweep complete')
}

/** Allow recovery after a crash without interrupting a healthy large send. */
function isStaleSending(statsJson: unknown, now: Date): boolean {
  if (!statsJson || typeof statsJson !== 'object' || Array.isArray(statsJson)) return true
  const startedAt = (statsJson as Record<string, unknown>)['startedAt']
  if (typeof startedAt !== 'string') return true
  const startedMs = Date.parse(startedAt)
  return !Number.isFinite(startedMs) || now.getTime() - startedMs >= 15 * 60 * 1000
}

/**
 * True when a job for this post is still waiting, delayed or running.
 *
 * A completed or failed job left in Redis by removeOnComplete/removeOnFail
 * retention does NOT count: it is a record of a past send, and treating it as
 * live would make the sweep skip a post forever.
 */
async function hasPendingJob(postId: string): Promise<boolean> {
  const job = await getQueue<BroadcastJobData>(QueueName.Broadcast).getJob(broadcastJobId(postId))
  if (!job) return false
  const state = await job.getState()
  if (state === 'completed' || state === 'failed') {
    // Clear it so the deterministic jobId is free for the next arming —
    // queue.add() with an id that already exists is silently a no-op.
    await job.remove()
    return false
  }
  return true
}

async function sendPost(postId: string, log: ReturnType<typeof jobLogger>): Promise<void> {
  const post = await prisma.broadcastPost.findUnique({ where: { id: postId } })
  if (!post) {
    log.warn({ postId }, 'broadcast job: post not found, dropping')
    return
  }

  const recipients = await resolveSegmentUsers(post.segment)
  if (recipients === null) {
    // Fail loudly instead of reporting a successful send to nobody: an
    // unrecognized segment is an admin/config bug that must be visible.
    log.error({ postId, segment: post.segment }, 'broadcast: unknown segment, refusing to send')
    await prisma.broadcastPost.update({
      where: { id: postId },
      data: {
        status: PostStatus.FAILED,
        statsJson: { error: `unknown segment: ${post.segment ?? 'null'}` }
      }
    })
    return
  }

  // Claim the post conditionally rather than with a bare update. The condition
  // IS the cancel guard: an admin who cancels while this job is being picked up
  // flips the row to CANCELLED, the claim then matches nothing, and not one
  // message goes out. A read-then-write would have raced straight past that.
  const stats: BroadcastStats = {
    total: recipients.length,
    sent: 0,
    blocked: 0,
    failed: 0,
    startedAt: new Date().toISOString(),
    finishedAt: ''
  }

  const claimed = await prisma.broadcastPost.updateMany({
    // Only an explicitly armed post may enter SENDING. This also makes
    // cancel/edit safe while a delayed job is being picked up.
    where: { id: postId, status: PostStatus.QUEUED },
    // startedAt lands with the claim, not at the end: it is what lets the sweep
    // tell a crashed fan-out from a healthy long-running one. Written only at
    // completion it would always be absent during SENDING, making that check
    // unconditionally true.
    data: { status: PostStatus.SENDING, statsJson: stats as unknown as object }
  })
  if (claimed.count === 0) {
    log.info({ postId, status: post.status }, 'broadcast job: post already sent or cancelled, skipping')
    return
  }

  const text = post.text

  // The admin setting is the live source of truth. Reading it once per post
  // keeps a long fan-out internally consistent while allowing the next send to
  // use a newly configured rate without a worker restart.
  const messagesPerSecond = await getSetting(prisma, 'broadcast_rate_per_sec', getRedisConnection())
  const intervalMs = Math.max(1, Math.floor(1000 / messagesPerSecond))

  for (const recipient of recipients) {
    let attemptsLeft = 3
    while (attemptsLeft > 0) {
      attemptsLeft -= 1
      try {
        await sendTelegramMessage(recipient.tgId, text, post.mediaUrl ? { photoUrl: post.mediaUrl } : undefined)
        stats.sent += 1
        break
      } catch (err) {
        if (err instanceof TelegramBlockedError) {
          await prisma.user.update({ where: { id: recipient.id }, data: { isBlocked: true } })
          stats.blocked += 1
          break
        }
        if (err instanceof TelegramRateLimitError) {
          log.warn({ retryAfterSeconds: err.retryAfterSeconds }, 'broadcast: rate limited, pausing batch')
          await sleep(err.retryAfterSeconds * 1000)
          continue // retry same recipient after the pause, without consuming the outer attempt budget further than necessary
        }
        if (attemptsLeft === 0) {
          stats.failed += 1
          log.error({ err, userId: recipient.id }, 'broadcast: failed to send to recipient, giving up')
        }
      }
    }
    await sleep(intervalMs)
  }

  stats.finishedAt = new Date().toISOString()

  const finalStatus = stats.sent > 0 || stats.total === 0 ? PostStatus.SENT : PostStatus.FAILED
  await prisma.broadcastPost.update({
    where: { id: postId },
    data: {
      status: finalStatus,
      sentAt: new Date(),
      statsJson: stats as unknown as object
    }
  })

  // Announced only for a post that actually reached SENT — a FAILED fan-out is
  // not a send, and emitting it as one would corrupt any consumer's send stats.
  if (finalStatus === PostStatus.SENT) {
    await emitEvent('broadcast.sent', {
      postId,
      total: stats.total,
      sent: stats.sent,
      blocked: stats.blocked,
      failed: stats.failed,
      sentAt: stats.finishedAt
    })
  }

  log.info({ postId, stats }, 'broadcast complete')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function startBroadcastWorker() {
  return createWorker<BroadcastJobData, void>(QueueName.Broadcast, processBroadcast)
}
