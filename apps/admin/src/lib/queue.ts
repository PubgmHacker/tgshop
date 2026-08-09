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
 * Producer handle for the worker's broadcast queue. Job name is always
 * "send-broadcast"; the worker app owns the corresponding Worker() consumer.
 * The connection is a plain ioredis client (BullMQ requires maxRetriesPerRequest: null,
 * already set on the shared getRedis() instance).
 */
export function getBroadcastQueue(): Queue<BroadcastJobData> {
  if (!globalThis.__tgshopBroadcastQueue) {
    globalThis.__tgshopBroadcastQueue = new Queue<BroadcastJobData>(getEnv().BROADCAST_QUEUE_NAME, {
      connection: getRedis()
    })
  }
  return globalThis.__tgshopBroadcastQueue
}

export const BROADCAST_JOB_NAME = 'send-broadcast'
