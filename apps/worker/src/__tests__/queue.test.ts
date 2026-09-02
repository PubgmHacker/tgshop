import { describe, expect, it } from 'vitest'
import {
  QUEUE_CONFIG,
  QueueName,
  deadLetterQueueName,
  defaultJobOptions,
  newCorrelationId,
  type QueueNameValue
} from '../queue.js'
import { BROADCAST_JOB_NAME, BROADCAST_SWEEP_JOB_NAME, broadcastJobId } from '../queues/broadcast.js'

const ALL_QUEUES = Object.values(QueueName) satisfies readonly QueueNameValue[]

describe('QUEUE_CONFIG', () => {
  // A missing entry would make defaultJobOptions() read `attempts` off
  // undefined and throw at enqueue time — in a worker that means the job is
  // never queued, which looks like "nothing happened" rather than an error.
  it('has an entry for every declared queue', () => {
    for (const name of ALL_QUEUES) {
      expect(QUEUE_CONFIG[name], `no config for ${name}`).toBeDefined()
    }
    expect(Object.keys(QUEUE_CONFIG).sort()).toEqual([...ALL_QUEUES].sort())
  })

  // The copy-paste hazard: QUEUE_CONFIG is keyed by queue name AND repeats the
  // name inside each value. A mismatched pair would apply one queue's retry
  // policy and concurrency to another, silently.
  it('has each entry pointing at its own key', () => {
    for (const name of ALL_QUEUES) {
      expect(QUEUE_CONFIG[name].name).toBe(name)
    }
  })

  it('gives every queue a usable retry policy', () => {
    for (const name of ALL_QUEUES) {
      const cfg = QUEUE_CONFIG[name]
      expect(cfg.concurrency).toBeGreaterThan(0)
      expect(cfg.attempts).toBeGreaterThan(0)
      expect(cfg.backoffDelayMs).toBeGreaterThan(0)
      expect(Number.isInteger(cfg.concurrency)).toBe(true)
      expect(Number.isInteger(cfg.attempts)).toBe(true)
    }
  })

  // Serial by design: chain-scan credits real money, so two concurrent runs
  // could match the same on-chain transfer twice.
  it('keeps the chain-scan queue strictly serial', () => {
    expect(QUEUE_CONFIG[QueueName.ChainScan].concurrency).toBe(1)
  })

  // BullMQ's QueueBase throws "Queue name cannot contain :" — ':' is its Redis
  // key separator. The original names (payments:poll, chain:scan, …) passed on
  // older 5.x releases and crash on current ones, and the unit suite never
  // constructed a real Queue, so nothing caught it before boot. This does.
  it('uses only queue names BullMQ accepts (no colons), DLQs included', () => {
    for (const name of ALL_QUEUES) {
      expect(name, `queue name ${name} would crash BullMQ`).not.toContain(':')
      expect(deadLetterQueueName(name)).not.toContain(':')
    }
  })
})

describe('deadLetterQueueName', () => {
  it('suffixes the queue name', () => {
    expect(deadLetterQueueName('delivery')).toBe('delivery-dlq')
    expect(deadLetterQueueName('chain-scan')).toBe('chain-scan-dlq')
  })

  // The DLQ must never collide with a real queue, or exhausted jobs would be
  // re-processed by the very worker that just gave up on them.
  it('never collides with a real queue name', () => {
    const real = new Set<string>(ALL_QUEUES)
    for (const name of ALL_QUEUES) {
      expect(real.has(deadLetterQueueName(name))).toBe(false)
    }
  })
})

describe('defaultJobOptions', () => {
  it('mirrors the queue config with exponential backoff', () => {
    for (const name of ALL_QUEUES) {
      const cfg = QUEUE_CONFIG[name]
      const opts = defaultJobOptions(name)
      expect(opts.attempts).toBe(cfg.attempts)
      expect(opts.backoff).toEqual({ type: 'exponential', delay: cfg.backoffDelayMs })
    }
  })

  // Failed jobs are retained far longer than completed ones on purpose: a
  // completed job is evidence of nothing, a failed one is the only record of
  // why a customer did not get their goods.
  it('retains failed jobs longer than completed ones', () => {
    const opts = defaultJobOptions(QueueName.Delivery)
    expect(opts.removeOnComplete).toEqual({ count: 1_000, age: 24 * 60 * 60 })
    expect(opts.removeOnFail).toEqual({ count: 5_000, age: 7 * 24 * 60 * 60 })
  })
})

describe('newCorrelationId', () => {
  it('produces distinct 12-character ids', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newCorrelationId()))
    expect(ids.size).toBe(500)
    for (const id of ids) expect(id).toHaveLength(12)
  })
})

describe('broadcast job contract', () => {
  // Byte-identical to apps/bot/src/domain/content.ts and
  // apps/admin/src/lib/queue.ts. scripts/verify-broadcast.mjs checks the same
  // thing across packages against real Redis; this pins it without either.
  it('builds a deterministic, prefixed job id', () => {
    expect(broadcastJobId('abc123')).toBe('broadcast-abc123')
    expect(broadcastJobId('abc123')).toBe(broadcastJobId('abc123'))
  })

  it('keeps the two job names on this queue distinct', () => {
    expect(BROADCAST_JOB_NAME).toBe('send-post')
    expect(BROADCAST_SWEEP_JOB_NAME).toBe('broadcast-sweep')
    expect(BROADCAST_JOB_NAME).not.toBe(BROADCAST_SWEEP_JOB_NAME)
  })
})
