import { publishEvent, type EventName, type EventPayloads } from '@tgshop/core'
import { getRedis } from './redis'

// ─────────────────────────────────────────────────────────────────────────────
// Domain event emission — the admin panel's side of the Phase-2 agent seam
// (packages/core/src/events.ts, docs/AGENT_PLAN.md).
//
// Mirrors apps/bot/src/domain/events.ts and apps/worker/src/events.ts, with the
// same two rules: emit only AFTER the transaction has committed, and a failed
// publish must never fail the admin action — the database write is the truth,
// the stream entry is the announcement.
// ─────────────────────────────────────────────────────────────────────────────

export async function emitEvent<E extends EventName>(
  event: E,
  payload: EventPayloads[E]
): Promise<void> {
  try {
    await publishEvent(getRedis(), event, payload)
  } catch (err) {
    console.error(`[events] failed to publish ${event}; admin action unaffected`, err)
  }
}
