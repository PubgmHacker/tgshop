import { publishEvent, type EventName, type EventPayloads } from '@tgshop/core'
import { getRedisConnection } from './redis.js'
import { logger } from './logger.js'

// ─────────────────────────────────────────────────────────────────────────────
// Domain event emission — the worker's side of the Phase-2 agent seam
// (packages/core/src/events.ts, docs/AGENT_PLAN.md).
//
// This mirrors apps/bot/src/domain/events.ts deliberately, and the same two
// rules apply, both about not lying to consumers:
//
// 1. EMIT AFTER COMMIT. An event published from inside a transaction that later
//    rolls back is a claim the consumer cannot retract. Every emit site sits
//    after its transaction has returned, never inside the callback.
//
// 2. A FAILED PUBLISH MUST NOT FAIL THE JOB. Redis being unreachable for XADD
//    is an analytics outage, not a commercial one — and in a worker it would be
//    worse than in the bot, because throwing here would send an already-settled
//    order back through BullMQ's retry machinery. So this swallows and logs.
//
// Note the connection is BullMQ's own ioredis client: the queues already hold
// it open for the process's lifetime, so publishing costs no extra socket.
// ─────────────────────────────────────────────────────────────────────────────

export async function emitEvent<E extends EventName>(
  event: E,
  payload: EventPayloads[E]
): Promise<void> {
  try {
    await publishEvent(getRedisConnection(), event, payload)
  } catch (err) {
    logger.error({ err, event }, 'failed to publish domain event; job unaffected')
  }
}
