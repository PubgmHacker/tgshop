import { getQueue, QueueName, defaultJobOptions, upsertRepeatable } from '../queue.js'

// ─────────────────────────────────────────────────────────────────────────────
// notify queue: admin-facing operational alerts. Other queues enqueue jobs
// here rather than sending Telegram messages directly, so all admin alerting
// goes through one throttled, retried path.
// ─────────────────────────────────────────────────────────────────────────────

export type NotifyJobData =
  | { kind: 'low_stock'; planTitle: string; remaining: number; threshold: number }
  | { kind: 'order_failed'; orderId: string; reason: string }
  | { kind: 'low_trx'; address: string; balanceTrxDisplay: string }
  | { kind: 'manual_fallback_sla'; orderId: string; ageMinutes: number }
  | { kind: 'sweep_failed'; address: string; reason: string }
  | { kind: 'chain_scan_error'; reason: string }

export async function enqueueNotify(data: NotifyJobData): Promise<void> {
  const queue = getQueue<NotifyJobData>(QueueName.Notify)
  await queue.add(data.kind, data, defaultJobOptions(QueueName.Notify))
}

/** Registers the manual-fallback SLA sweep as a repeatable job (checks every 5 min). */
export async function registerNotifyRepeatables(): Promise<void> {
  await upsertRepeatable(QueueName.Notify, 'manual-fallback-sla-sweep', 5 * 60 * 1000)
}
