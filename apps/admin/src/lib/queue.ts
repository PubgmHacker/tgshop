import { Queue } from 'bullmq'
import { getRedis } from './redis'
import { getEnv } from './env'

export interface BroadcastJobData {
  postId: string
}

declare global {
  // eslint-disable-next-line no-var
  var __tgshopBroadcastQueue: Queue<BroadcastJobData> | undefined
}

/**
 * Producer handle for the worker's broadcast queue. The connection is a plain
 * ioredis client (BullMQ requires maxRetriesPerRequest: null, already set on the
 * shared getRedis() instance).
 */
export function getBroadcastQueue(): Queue<BroadcastJobData> {
  if (!globalThis.__tgshopBroadcastQueue) {
    globalThis.__tgshopBroadcastQueue = new Queue<BroadcastJobData>(getEnv().BROADCAST_QUEUE_NAME, {
      connection: getRedis()
    })
  }
  return globalThis.__tgshopBroadcastQueue
}

// The job name MUST stay byte-identical to apps/worker/src/queues/broadcast.ts
// and apps/bot/src/domain/content.ts. It used to be 'send-broadcast' here while
// both of those used 'send-post'; BullMQ routes by queue and not by name, so the
// mismatch did not break delivery — but it made admin-produced jobs invisible to
// any name-based filtering, and it left three spellings of one contract.
export const BROADCAST_JOB_NAME = 'send-post'

/**
 * Deterministic job id for a post's send job.
 *
 * Two reasons it cannot be left to BullMQ's auto-id: a delayed job can only be
 * cancelled by something that can name it, and a stable id makes enqueueing
 * idempotent — the admin's "Send" and the worker's scheduled sweep can both fire
 * for one post without it going out twice.
 */
export function broadcastJobId(postId: string): string {
  return `broadcast-${postId}`
}
