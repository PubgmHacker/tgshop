import { publishEvent, type EventName, type EventPayloads } from '@tgshop/core'
import { redis } from '../config/redis.js'
import { logger } from '../lib/logger.js'

// ─────────────────────────────────────────────────────────────────────────────
// Domain event emission — the bot's side of the Phase-2 agent seam
// (packages/core/src/events.ts, docs/AGENT_PLAN.md).
//
// Two rules govern every call, and both are about not lying to consumers:
//
// 1. EMIT AFTER COMMIT. An event published from inside a transaction that later
//    rolls back is a claim the consumer cannot retract — an agent would be told
//    an order was paid while the database says it never was. Every emit site in
//    this app therefore sits *after* an `await prisma.$transaction(...)` has
//    returned, never inside the callback.
//
// 2. A FAILED PUBLISH MUST NOT FAIL THE PURCHASE. Redis being unreachable is an
//    analytics outage, not a commercial one: the money moved and the goods were
//    handed over regardless, and throwing here would turn a completed sale into
//    an error the buyer sees. So this swallows and logs, which also means
//    callers can `await` it without wrapping it in a try/catch of their own.
//
// The stream is Redis Streams (XADD) via core, so publishing is fire-and-store,
// not fire-and-forget: consumers that were offline still see the entry later.
// ─────────────────────────────────────────────────────────────────────────────

export async function emitEvent<E extends EventName>(
  event: E,
  payload: EventPayloads[E]
): Promise<void> {
  try {
    await publishEvent(redis, event, payload)
  } catch (err) {
    logger.error({ err, event }, 'failed to publish domain event; purchase unaffected')
  }
}
