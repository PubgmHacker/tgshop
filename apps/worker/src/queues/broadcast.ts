import { getQueue, QueueName, defaultJobOptions } from '../queue.js'

// ─────────────────────────────────────────────────────────────────────────────
// broadcast queue: fans a BroadcastPost out to its target audience with a
// single rate-limit-safe "send-batch" job per post that internally paces
// itself, rather than one BullMQ job per recipient (keeps queue depth sane
// for large segments and lets us honor the global ≤25 msg/s Telegram cap
// with one shared token bucket per job run).
//
// Two job names share this queue:
//   send-post        one post's fan-out. Carries `postId`.
//   broadcast-sweep  the periodic re-arm sweep. Carries nothing.
//
// The job name and jobId MUST stay byte-identical to the other two producers,
// apps/bot/src/domain/content.ts and apps/admin/src/lib/queue.ts. BullMQ routes
// by queue rather than by name, so a mismatch does not fail loudly — it just
// leaves three spellings of one contract and breaks anything that addresses a
// job by name.
// ─────────────────────────────────────────────────────────────────────────────

export const BROADCAST_JOB_NAME = 'send-post'
export const BROADCAST_SWEEP_JOB_NAME = 'broadcast-sweep'

/**
 * Data for either job on this queue. `postId` is absent on the sweep, which
 * operates over the whole table rather than one post — a single optional field
 * is cheaper than a discriminated union for a two-member set, and the worker
 * narrows on it before doing anything.
 */
export interface BroadcastJobData {
  postId?: string
}

/**
 * Deterministic job id for a post's send job.
 *
 * Load-bearing twice over: a delayed job nobody can name is a delayed job nobody
 * can cancel, and a stable id makes enqueueing idempotent — the admin's "Send",
 * the bot's publishPost() and the re-arm sweep can all fire for one post without
 * it going out twice.
 */
export function broadcastJobId(postId: string): string {
  return `broadcast-${postId}`
}

/**
 * Arms a post for delivery, optionally holding it until its scheduled time.
 *
 * `delayMs` is BullMQ's own delay rather than a sleep in the worker: a delayed
 * job costs nothing while it waits and can be removed by id, which is what makes
 * "cancel a broadcast scheduled for next Tuesday" expressible at all.
 */
export async function enqueueBroadcast(postId: string, delayMs = 0): Promise<void> {
  const queue = getQueue<BroadcastJobData>(QueueName.Broadcast)
  await queue.add(
    BROADCAST_JOB_NAME,
    { postId },
    { ...defaultJobOptions(QueueName.Broadcast), jobId: broadcastJobId(postId), delay: delayMs }
  )
}
