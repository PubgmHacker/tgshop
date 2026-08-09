import type { Job } from 'bullmq'
import { prisma, PostStatus } from '@tgshop/db'
import { parseSegment, resolveSegmentRecipients, type SegmentRecipient } from '@tgshop/core'
import { createWorker, QueueName, newCorrelationId } from '../queue.js'
import { jobLogger } from '../logger.js'
import { sendTelegramMessage, TelegramBlockedError, TelegramRateLimitError } from '../telegram.js'
import type { BroadcastJobData } from './broadcast.js'
import { loadEnv } from '../env.js'

// ─────────────────────────────────────────────────────────────────────────────
// broadcast worker: sends BroadcastPost.text (+ optional mediaUrl, sent as a
// trailing link since our thin Telegram client only wraps sendMessage) to
// every non-blocked User matching `segment`, at up to
// BROADCAST_MAX_MSGS_PER_SEC messages/second globally, honoring 429
// retry_after by pausing the whole batch, and flagging User.isBlocked on 403.
// Writes final counts to BroadcastPost.statsJson and moves status to SENT
// (or FAILED if the post could not be sent to anyone).
// ─────────────────────────────────────────────────────────────────────────────

interface BroadcastStats {
  total: number
  sent: number
  blocked: number
  failed: number
  startedAt: string
  finishedAt: string
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
  const env = loadEnv()
  const { postId } = job.data

  const post = await prisma.broadcastPost.findUnique({ where: { id: postId } })
  if (!post) {
    log.warn({ postId }, 'broadcast job: post not found, dropping')
    return
  }
  if (post.status === PostStatus.SENT) {
    log.info({ postId }, 'broadcast job: already sent, skipping')
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

  await prisma.broadcastPost.update({ where: { id: postId }, data: { status: PostStatus.SENDING } })

  const text = post.mediaUrl ? `${post.text}\n\n${post.mediaUrl}` : post.text

  const stats: BroadcastStats = {
    total: recipients.length,
    sent: 0,
    blocked: 0,
    failed: 0,
    startedAt: new Date().toISOString(),
    finishedAt: ''
  }

  const intervalMs = Math.max(1, Math.floor(1000 / env.BROADCAST_MAX_MSGS_PER_SEC))

  for (const recipient of recipients) {
    let attemptsLeft = 3
    while (attemptsLeft > 0) {
      attemptsLeft -= 1
      try {
        await sendTelegramMessage(recipient.tgId, text)
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

  await prisma.broadcastPost.update({
    where: { id: postId },
    data: {
      status: stats.sent > 0 || stats.total === 0 ? PostStatus.SENT : PostStatus.FAILED,
      sentAt: new Date(),
      statsJson: stats as unknown as object
    }
  })

  log.info({ postId, stats }, 'broadcast complete')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function startBroadcastWorker() {
  return createWorker<BroadcastJobData, void>(QueueName.Broadcast, processBroadcast)
}
