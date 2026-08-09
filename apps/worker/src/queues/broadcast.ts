import { getQueue, QueueName, defaultJobOptions } from '../queue.js'

// ─────────────────────────────────────────────────────────────────────────────
// broadcast queue: fans a BroadcastPost out to its target audience with a
// single rate-limit-safe "send-batch" job per post that internally paces
// itself, rather than one BullMQ job per recipient (keeps queue depth sane
// for large segments and lets us honor the global ≤25 msg/s Telegram cap
// with one shared token bucket per job run).
// ─────────────────────────────────────────────────────────────────────────────

export interface BroadcastJobData {
  postId: string
}

export async function enqueueBroadcast(postId: string): Promise<void> {
  const queue = getQueue<BroadcastJobData>(QueueName.Broadcast)
  await queue.add('send-post', { postId }, { ...defaultJobOptions(QueueName.Broadcast), jobId: `broadcast-${postId}` })
}
