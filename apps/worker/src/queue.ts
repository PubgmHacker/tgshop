import { Queue, QueueEvents, Worker, type Job, type JobsOptions, type Processor } from 'bullmq'
import { getRedisConnection } from './redis.js'
import { logger } from './logger.js'
import { nanoid } from 'nanoid'

// ─────────────────────────────────────────────────────────────────────────────
// Shared BullMQ queue infrastructure: queue names, default retry/backoff
// policy, per-queue concurrency, and a uniform dead-letter queue mechanism.
// ─────────────────────────────────────────────────────────────────────────────

export const QueueName = {
  PaymentsPoll: 'payments:poll',
  ChainScan: 'chain:scan',
  ChainSweep: 'chain:sweep',
  Delivery: 'delivery',
  OrdersExpire: 'orders:expire',
  SubsRemind: 'subs:remind',
  Broadcast: 'broadcast',
  Notify: 'notify'
} as const

export type QueueNameValue = (typeof QueueName)[keyof typeof QueueName]

export function deadLetterQueueName(queueName: string): string {
  return `${queueName}:dlq`
}

export interface QueueConfig {
  name: QueueNameValue
  concurrency: number
  attempts: number
  backoffDelayMs: number
}

export const QUEUE_CONFIG: Record<QueueNameValue, QueueConfig> = {
  [QueueName.PaymentsPoll]: { name: QueueName.PaymentsPoll, concurrency: 5, attempts: 5, backoffDelayMs: 5_000 },
  [QueueName.ChainScan]: { name: QueueName.ChainScan, concurrency: 1, attempts: 5, backoffDelayMs: 5_000 },
  [QueueName.ChainSweep]: { name: QueueName.ChainSweep, concurrency: 1, attempts: 3, backoffDelayMs: 10_000 },
  [QueueName.Delivery]: { name: QueueName.Delivery, concurrency: 10, attempts: 5, backoffDelayMs: 3_000 },
  [QueueName.OrdersExpire]: { name: QueueName.OrdersExpire, concurrency: 3, attempts: 3, backoffDelayMs: 5_000 },
  [QueueName.SubsRemind]: { name: QueueName.SubsRemind, concurrency: 3, attempts: 3, backoffDelayMs: 5_000 },
  [QueueName.Broadcast]: { name: QueueName.Broadcast, concurrency: 5, attempts: 5, backoffDelayMs: 2_000 },
  [QueueName.Notify]: { name: QueueName.Notify, concurrency: 5, attempts: 3, backoffDelayMs: 2_000 }
}

const queues = new Map<string, Queue>()

export function getQueue<T = unknown>(name: QueueNameValue): Queue<T> {
  const existing = queues.get(name)
  if (existing) return existing as Queue<T>
  const queue = new Queue<T>(name, { connection: getRedisConnection() })
  queues.set(name, queue)
  return queue
}

export function getDeadLetterQueue<T = unknown>(name: QueueNameValue): Queue<T> {
  const dlqName = deadLetterQueueName(name)
  const existing = queues.get(dlqName)
  if (existing) return existing as Queue<T>
  const queue = new Queue<T>(dlqName, { connection: getRedisConnection() })
  queues.set(dlqName, queue)
  return queue
}

export function defaultJobOptions(name: QueueNameValue): JobsOptions {
  const cfg = QUEUE_CONFIG[name]
  return {
    attempts: cfg.attempts,
    backoff: { type: 'exponential', delay: cfg.backoffDelayMs },
    removeOnComplete: { count: 1_000, age: 24 * 60 * 60 },
    removeOnFail: { count: 5_000, age: 7 * 24 * 60 * 60 }
  }
}

/** Correlation id for structured log tracing across a single job's lifetime. */
export function newCorrelationId(): string {
  return nanoid(12)
}

const activeWorkers: Worker[] = []
const activeQueueEvents: QueueEvents[] = []

/**
 * Creates a BullMQ Worker for `name` with the queue's configured concurrency,
 * wraps `processor` with correlation-id logging, and wires a `failed` handler
 * that moves permanently-exhausted jobs (attemptsMade >= attempts) onto the
 * matching dead-letter queue for manual inspection/replay.
 */
export function createWorker<T = unknown, R = unknown>(
  name: QueueNameValue,
  processor: Processor<T, R>
): Worker<T, R> {
  const cfg = QUEUE_CONFIG[name]
  const worker = new Worker<T, R>(name, processor, {
    connection: getRedisConnection(),
    concurrency: cfg.concurrency
  })

  worker.on('failed', (job, err) => {
    void handleJobFailure(name, job, err)
  })

  worker.on('error', (err) => {
    logger.error({ err, queue: name }, 'worker-level error')
  })

  activeWorkers.push(worker)
  return worker
}

async function handleJobFailure(name: QueueNameValue, job: Job<unknown> | undefined, err: Error): Promise<void> {
  if (!job) return
  const cfg = QUEUE_CONFIG[name]
  const exhausted = job.attemptsMade >= cfg.attempts
  logger.error(
    { queue: name, jobId: job.id, attemptsMade: job.attemptsMade, exhausted, err: err.message },
    'job failed'
  )
  if (!exhausted) return
  try {
    const dlq = getDeadLetterQueue(name)
    await dlq.add(
      job.name,
      { originalJobId: job.id, originalData: job.data, failedReason: err.message, failedAt: new Date().toISOString() },
      { removeOnComplete: { count: 5_000 }, removeOnFail: false }
    )
    logger.warn({ queue: name, jobId: job.id }, 'job moved to dead-letter queue')
  } catch (dlqErr) {
    logger.error({ dlqErr, queue: name, jobId: job.id }, 'failed to move job to dead-letter queue')
  }
}

/** Registers a repeatable job idempotently: removes any existing repeatable schedule for the jobName then re-adds it. */
export async function upsertRepeatable(
  name: QueueNameValue,
  jobName: string,
  everyMs: number,
  data: unknown = {}
): Promise<void> {
  const queue = getQueue(name)
  const existingRepeatables = await queue.getJobSchedulers()
  for (const schedule of existingRepeatables) {
    // `id` is typed nullable by BullMQ; a scheduler without one cannot be
    // addressed by removeJobScheduler, so skip it rather than crash. The
    // upsert below is keyed by scheduler id and is itself idempotent, so a
    // skipped stale entry is at worst a duplicate schedule, never a lost one.
    if (schedule.name === jobName && schedule.id) {
      await queue.removeJobScheduler(schedule.id)
    }
  }
  await queue.upsertJobScheduler(
    `${jobName}-scheduler`,
    { every: everyMs },
    { name: jobName, data, opts: defaultJobOptions(name) }
  )
}

export async function closeAllWorkers(): Promise<void> {
  await Promise.all(activeWorkers.map((w) => w.close()))
  await Promise.all(activeQueueEvents.map((e) => e.close()))
  await Promise.all(Array.from(queues.values()).map((q) => q.close()))
}

export function getActiveWorkers(): readonly Worker[] {
  return activeWorkers
}
