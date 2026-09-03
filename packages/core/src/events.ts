import type { Redis } from 'ioredis'
import type { PaymentProvider } from '@tgshop/db'

// ─────────────────────────────────────────────────────────────────────────────
// Typed event bus over Redis Streams — the Phase-2 LLM-agent seam
// (see docs/AGENT_PLAN.md).
//
// Wire format, one entry per event, matching the table in AGENT_PLAN.md:
//   type          event name, e.g. "order.paid"
//   schemaVersion "1" — bump only for a breaking payload change
//   emittedAt     ISO-8601 timestamp
//   data          the payload, JSON-encoded into a single field because Redis
//                 Streams entries are flat field/value maps and cannot nest
//
// BigInt columns (User.tgId, Payment.amount) travel as decimal STRINGS: JSON
// cannot represent a BigInt, and silently narrowing a Telegram id to a double
// would corrupt it.
//
// Delivery guarantee is at-least-once: XACK happens only after the handler
// resolves, so a crash mid-handler leaves the entry pending for redelivery.
// Handlers must therefore be idempotent.
// ─────────────────────────────────────────────────────────────────────────────

export type EventName =
  | 'order.paid'
  | 'order.delivered'
  | 'order.failed'
  | 'order.refunded'
  | 'stock.low'
  | 'stock.depleted'
  | 'payment.received'
  | 'payment.underpaid'
  | 'payment.reconcile_mismatch'
  | 'user.registered'
  | 'subscription.expiring_soon'
  | 'broadcast.sent'

export interface EventPayloads {
  'order.paid': {
    orderId: string
    userId: string
    planId: string
    provider: PaymentProvider
    amountCents: number
  }
  'order.delivered': {
    orderId: string
    userId: string
    planId: string
    deliveredAt: string
  }
  'order.failed': {
    orderId: string
    userId: string
    reason: string
    refundedCents: number
  }
  'order.refunded': {
    orderId: string
    userId: string
    planId: string
    /** What was credited back to the buyer's balance; 0 for a zero-amount order. */
    refundedCents: number
    reason: string
    /** Who initiated it: "admin" (panel), "agent" (/internal), "system" (auto-refund). */
    refundedBy: 'admin' | 'agent' | 'system'
  }
  'stock.low': {
    planId: string
    productId: string
    available: number
    threshold: number
  }
  'stock.depleted': {
    planId: string
    productId: string
  }
  'payment.received': {
    paymentId: string
    orderId: string | null
    userId: string
    provider: PaymentProvider
    /** Smallest-unit amount as a decimal string (BigInt-safe). */
    amount: string
    asset: string
    txHash: string | null
  }
  'payment.underpaid': {
    paymentId: string
    orderId: string | null
    /** Expected/received in USDT 6-decimals, decimal strings (BigInt-safe). */
    expected6: string
    received6: string
    /** Received plus balance credits from earlier short payments on the same order. */
    effective6?: string
  }
  'payment.reconcile_mismatch': {
    provider: PaymentProvider
    paymentId: string
    orderId: string | null
    /**
     * Machine-readable disagreement class. Current values:
     *   "paid_no_order"     provider says paid, but the payment row is linked
     *                       to no order — money with no purchase to settle.
     *   "paid_order_closed" provider says paid, but the order already reached
     *                       a terminal state (EXPIRED/FAILED/REFUNDED) through
     *                       another path — a late or contested payment.
     * Consumers must tolerate unknown future values (flag, don't crash).
     */
    kind: string
    /** Human-readable context for the admin audit trail. */
    detail: string
  }
  'user.registered': {
    userId: string
    /** Telegram id as a decimal string (BigInt-safe). */
    tgId: string
    referredById: string | null
  }
  'subscription.expiring_soon': {
    subscriptionId: string
    userId: string
    planId: string
    expiresAt: string
    /** Whole days until expiry at emission time (3 or 1 for the current reminder windows). */
    daysLeft: number
  }
  'broadcast.sent': {
    postId: string
    total: number
    sent: number
    blocked: number
    failed: number
    sentAt: string
  }
}

export const EVENT_SCHEMA_VERSION = '1'

const STREAM_PREFIX = 'tgshop:events:'

const STREAM_BY_EVENT: Record<EventName, string> = {
  'order.paid': `${STREAM_PREFIX}orders`,
  'order.delivered': `${STREAM_PREFIX}orders`,
  'order.failed': `${STREAM_PREFIX}orders`,
  'order.refunded': `${STREAM_PREFIX}orders`,
  'stock.low': `${STREAM_PREFIX}stock`,
  'stock.depleted': `${STREAM_PREFIX}stock`,
  'payment.received': `${STREAM_PREFIX}payments`,
  'payment.underpaid': `${STREAM_PREFIX}payments`,
  'payment.reconcile_mismatch': `${STREAM_PREFIX}payments`,
  'user.registered': `${STREAM_PREFIX}users`,
  'subscription.expiring_soon': `${STREAM_PREFIX}subs`,
  'broadcast.sent': `${STREAM_PREFIX}broadcasts`
}

/** The stream an event is published to. Related events share a stream, one per domain. */
export function streamKeyFor(event: EventName): string {
  return STREAM_BY_EVENT[event]
}

function isEventName(value: string): value is EventName {
  return Object.prototype.hasOwnProperty.call(STREAM_BY_EVENT, value)
}

/** Appends an event to its stream. Returns the Redis entry id. */
export async function publishEvent<E extends EventName>(
  redis: Redis,
  event: E,
  payload: EventPayloads[E]
): Promise<string> {
  const id = await redis.xadd(
    streamKeyFor(event),
    '*',
    'type',
    event,
    'schemaVersion',
    EVENT_SCHEMA_VERSION,
    'emittedAt',
    new Date().toISOString(),
    'data',
    JSON.stringify(payload)
  )
  if (typeof id !== 'string') {
    throw new Error(`publishEvent: XADD returned no entry id for ${event}`)
  }
  return id
}

export interface ConsumerOptions {
  group: string
  consumer: string
  events: EventName[]
  blockMs?: number
  batchSize?: number
  /** Additive: stop the read loop cooperatively. */
  signal?: AbortSignal
  /** Additive: process at most one batch, then return (used by tests and one-shot jobs). */
  once?: boolean
  /**
   * Additive: called when a handler throws. The entry stays UNACKED either way.
   * Without it the error propagates out of consumeEvents; with it the loop
   * continues, because a single poison entry should not stop a worker.
   */
  onError?: (err: unknown, entry: { name: EventName; id: string }) => void
}

const DEFAULT_BLOCK_MS = 5_000
const DEFAULT_BATCH_SIZE = 16

function streamKeysFor(events: EventName[]): string[] {
  return [...new Set(events.map(streamKeyFor))]
}

/**
 * Creates the consumer group on every stream the options mention, starting at
 * "$" (new entries only) and creating the stream if it does not exist yet.
 * BUSYGROUP is the expected steady-state answer and is swallowed, which is what
 * makes this safe to call on every worker boot.
 */
export async function ensureConsumerGroups(redis: Redis, opts: ConsumerOptions): Promise<void> {
  for (const key of streamKeysFor(opts.events)) {
    try {
      await redis.xgroup('CREATE', key, opts.group, '$', 'MKSTREAM')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!message.includes('BUSYGROUP')) throw err
    }
  }
}

interface ParsedEntry {
  name: EventName
  payload: unknown
  id: string
}

interface RawEntry {
  streamKey: string
  id: string
  /** null when the entry is unreadable or carries an event type we do not know. */
  name: EventName | null
  payload: unknown
}

function fieldsToMap(fields: unknown): Map<string, string> {
  const map = new Map<string, string>()
  if (!Array.isArray(fields)) return map
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const field = fields[i]
    const value = fields[i + 1]
    if (typeof field === 'string' && typeof value === 'string') {
      map.set(field, value)
    }
  }
  return map
}

/**
 * Flattens the XREADGROUP reply — [[stream, [[id, [f, v, ...]], ...]], ...] —
 * into entries. Anything malformed is reported with a null name so the caller
 * can ACK and move on rather than wedging the group on an unreadable entry.
 */
function parseReply(reply: unknown): RawEntry[] {
  const out: RawEntry[] = []
  if (!Array.isArray(reply)) return out

  for (const stream of reply) {
    if (!Array.isArray(stream) || stream.length < 2) continue
    const streamKey = stream[0]
    const entries = stream[1]
    if (typeof streamKey !== 'string' || !Array.isArray(entries)) continue

    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length < 2) continue
      const id = entry[0]
      if (typeof id !== 'string') continue

      const fields = fieldsToMap(entry[1])
      const type = fields.get('type')
      if (type === undefined || !isEventName(type)) {
        out.push({ streamKey, id, name: null, payload: null })
        continue
      }

      const raw = fields.get('data')
      let payload: unknown = null
      if (raw !== undefined) {
        try {
          payload = JSON.parse(raw)
        } catch {
          out.push({ streamKey, id, name: null, payload: null })
          continue
        }
      }
      out.push({ streamKey, id, name: type, payload })
    }
  }

  return out
}

/**
 * Reads and dispatches events for a consumer group until the options' signal
 * aborts (or forever). Call ensureConsumerGroups() first.
 *
 * ACK ordering is the whole point: an entry is XACKed only after its handler
 * resolves. Entries this consumer does not subscribe to — unknown future event
 * types, or another event sharing the same stream — are ACKed without being
 * handled, so they cannot pile up in this group's pending list.
 */
export async function consumeEvents(
  redis: Redis,
  opts: ConsumerOptions,
  handler: (e: { name: EventName; payload: unknown; id: string }) => Promise<void>
): Promise<void> {
  const keys = streamKeysFor(opts.events)
  if (keys.length === 0) return

  const blockMs = opts.blockMs ?? DEFAULT_BLOCK_MS
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE
  const subscribed = new Set<EventName>(opts.events)

  for (;;) {
    if (opts.signal?.aborted) return

    const reply: unknown = await redis.xreadgroup(
      'GROUP',
      opts.group,
      opts.consumer,
      'COUNT',
      batchSize,
      'BLOCK',
      blockMs,
      'STREAMS',
      ...keys,
      // ">" = entries never delivered to this group before.
      ...keys.map(() => '>')
    )

    for (const entry of parseReply(reply)) {
      if (entry.name === null || !subscribed.has(entry.name)) {
        await redis.xack(entry.streamKey, opts.group, entry.id)
        continue
      }

      const parsed: ParsedEntry = { name: entry.name, payload: entry.payload, id: entry.id }
      try {
        await handler(parsed)
      } catch (err) {
        if (!opts.onError) throw err
        opts.onError(err, { name: parsed.name, id: parsed.id })
        continue // deliberately unacked: it stays pending for a retry
      }
      await redis.xack(entry.streamKey, opts.group, entry.id)
    }

    if (opts.once) return
  }
}
