import { getQueue, QueueName, defaultJobOptions } from '../queue.js'

// ─────────────────────────────────────────────────────────────────────────────
// delivery queue: delivers a PAID order (assigns/decrypts stock, or calls an
// external API, or raises a manual-fallback task), then marks DELIVERED.
// On repeated failure past BullMQ's attempts, the DLQ handler in queue.ts
// takes over — but we also proactively mark the order FAILED + refund on the
// job's own last attempt via markFailedAndRefund() called from the processor.
// ─────────────────────────────────────────────────────────────────────────────

export interface DeliveryJobData {
  orderId: string
}

export async function enqueueDelivery(orderId: string): Promise<void> {
  const queue = getQueue<DeliveryJobData>(QueueName.Delivery)
  await queue.add(
    'deliver-order',
    { orderId },
    { ...defaultJobOptions(QueueName.Delivery), jobId: `deliver-${orderId}` }
  )
}
