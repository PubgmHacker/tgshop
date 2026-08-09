import { PostStatus } from '@tgshop/db'

// ─────────────────────────────────────────────────────────────────────────────
// What an admin is allowed to do to a broadcast post.
//
// Lives outside lib/actions/broadcasts.ts because that file is a `'use server'`
// module: every export there must be an async server action, so it cannot also
// export the predicates the table needs to decide which buttons to render.
// Keeping them here means the page and the action decide from the SAME rule
// instead of drifting into a UI that offers an operation the server refuses.
//
// ── The status ladder ────────────────────────────────────────────────────────
//   DRAFT / SCHEDULED   saved, NOT handed to the queue. Nothing is delivered.
//   QUEUED              handed to BullMQ, possibly holding a delay. Still
//                       cancellable, because nothing has been sent yet.
//   SENDING             the worker has started fanning out. Recipients have
//                       already received messages, so there is nothing left to
//                       cancel and nothing safe to edit.
//   SENT / FAILED / CANCELLED   terminal.
//
// QUEUED exists precisely so "armed" and "in flight" are distinguishable. They
// used to share SENDING, which made a broadcast scheduled a week out frozen and
// uncancellable from the moment it was queued.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Statuses whose row is a record of something already in flight or finished.
 * Editing or deleting these would rewrite history — or, worse, change the text
 * mid-send, since the worker reads the post row per job and not per recipient.
 */
export const FROZEN_STATUSES: readonly PostStatus[] = [PostStatus.SENDING, PostStatus.SENT]

/** True when the post may still be edited or deleted. A QUEUED post may be — arming is undone first. */
export function isBroadcastFrozen(status: PostStatus): boolean {
  return FROZEN_STATUSES.includes(status)
}

/**
 * True when there is a pending queue job to pull. Only QUEUED qualifies: a
 * SENDING post's messages are already going out, and every other status was
 * never handed to the queue in the first place.
 */
export function isBroadcastCancellable(status: PostStatus): boolean {
  return status === PostStatus.QUEUED
}

/**
 * True when the post may be handed to the queue.
 *
 * CANCELLED and FAILED are deliberately included: pulling a broadcast back,
 * fixing it and re-arming it is the normal way to use the cancel button, and a
 * failed run is exactly the thing an operator wants to retry.
 */
export function isBroadcastSendable(status: PostStatus): boolean {
  return !isBroadcastFrozen(status) && status !== PostStatus.QUEUED
}
