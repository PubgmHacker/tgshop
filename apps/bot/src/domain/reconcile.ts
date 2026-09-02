import { Queue } from 'bullmq'
import { PaymentProvider } from '@tgshop/db'
import { redis } from '../config/redis.js'
import { logger } from '../lib/logger.js'

// ─────────────────────────────────────────────────────────────────────────────
// On-demand payment reconciliation (docs/AGENT_PLAN.md, POST /internal/reconcile).
//
// The heavy lifting already exists as the worker's scheduled sweeps; this module
// only enqueues an extra, immediate pass on the right queue. Queue names MUST
// stay byte-identical to apps/worker/src/queue.ts::QueueName — BullMQ routes by
// queue name, so a mismatch would silently enqueue jobs no worker consumes
// (same contract note as domain/content.ts).
//
//   CRYPTOBOT   -> "payments-poll"  re-checks PENDING/CONFIRMING invoices
//   TRON_TRC20  -> "chain-scan"     re-reads the receive wallet on TronGrid
//
// BALANCE and STARS have no provider-side ledger to disagree with (balance is
// our own ledger; Stars settle synchronously inside Telegram before the order
// is ever marked paid), so there is deliberately nothing to enqueue for them.
// ─────────────────────────────────────────────────────────────────────────────

export const RECONCILE_JOB_NAME = 'manual-reconcile'

interface ReconcileTarget {
  queueName: string
  /** Worker attempts/backoff for a manual pass; transient Redis/API blips retry, then the DLQ has it. */
  attempts: number
  backoffDelayMs: number
}

const RECONCILE_TARGETS: Partial<Record<PaymentProvider, ReconcileTarget>> = {
  [PaymentProvider.CRYPTOBOT]: { queueName: 'payments-poll', attempts: 3, backoffDelayMs: 5_000 },
  [PaymentProvider.TRON_TRC20]: { queueName: 'chain-scan', attempts: 3, backoffDelayMs: 5_000 }
}

export type ReconcilableProvider = Extract<PaymentProvider, 'CRYPTOBOT' | 'TRON_TRC20'>

export function isReconcilableProvider(provider: PaymentProvider): provider is ReconcilableProvider {
  return provider in RECONCILE_TARGETS
}

export interface ReconcileJobData {
  /** Advisory look-back window. The current sweeps re-check ALL pending rows regardless; carried for an incremental pass later. */
  sinceMinutes: number | null
  requestedAt: string
}

const queues = new Map<string, Queue<ReconcileJobData>>()

function getReconcileQueue(queueName: string): Queue<ReconcileJobData> {
  const existing = queues.get(queueName)
  if (existing) return existing
  // Producing jobs is non-blocking, so the shared ioredis client is safe to
  // reuse (maxRetriesPerRequest: null is already set, which BullMQ requires).
  const queue = new Queue<ReconcileJobData>(queueName, { connection: redis })
  queues.set(queueName, queue)
  return queue
}

export interface EnqueuedReconcile {
  queue: string
  jobId: string
}

/**
 * Enqueues one immediate reconciliation pass for the provider.
 *
 * The jobId buckets requests to the second, so a double-fired request (an agent
 * retrying a timed-out POST) collapses into one job, while a genuinely new
 * request a moment later still runs. The worker's processors do not branch on
 * job name, so the distinct "manual-reconcile" name costs nothing and makes
 * manual passes visible in job logs and the DLQ.
 */
export async function enqueueReconcile(
  provider: ReconcilableProvider,
  sinceMinutes: number | null
): Promise<EnqueuedReconcile> {
  const target = RECONCILE_TARGETS[provider] as ReconcileTarget
  const queue = getReconcileQueue(target.queueName)
  const jobId = `${RECONCILE_JOB_NAME}:${provider}:${Math.floor(Date.now() / 1000)}`

  await queue.add(
    RECONCILE_JOB_NAME,
    { sinceMinutes, requestedAt: new Date().toISOString() },
    {
      jobId,
      attempts: target.attempts,
      backoff: { type: 'exponential', delay: target.backoffDelayMs },
      removeOnComplete: { count: 1_000, age: 24 * 60 * 60 },
      removeOnFail: { count: 5_000, age: 7 * 24 * 60 * 60 }
    }
  )

  return { queue: target.queueName, jobId }
}

export async function closeReconcileQueues(): Promise<void> {
  for (const [name, queue] of queues) {
    try {
      await queue.close()
    } catch (err) {
      logger.warn({ err, queue: name }, 'failed to close reconcile queue cleanly')
    } finally {
      queues.delete(name)
    }
  }
}
