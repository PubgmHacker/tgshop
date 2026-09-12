import { randomInt } from 'node:crypto'
import { prisma, PaymentProvider, PaymentStatus } from '@tgshop/db'
import { TRON_TAG_MAX, tronTagOfAmountUsdt6 } from '@tgshop/core'
import { env } from '../config/env.js'
import { redis } from '../config/redis.js'
import { logger } from '../lib/logger.js'
import { resolveTronReceiveAddress } from './tron-address.js'

// ─────────────────────────────────────────────────────────────────────────────
// USDT-TRC20 on ONE static receive address (the owner's own wallet).
//
// There is no per-order deposit address and no hot key anywhere in the system:
// customers pay straight into the owner's wallet, and the worker watches that
// single address on TronGrid. What tells one invoice from another is the
// amount — every open invoice for the same price gets a unique sub-cent tag
// (0.0001 USDT steps, see @tgshop/core tronTaggedAmountUsdt6), so "$29.00"
// becomes 29.0057 USDT for one customer and 29.0058 for the next. The worker
// matches an inbound transfer to the open invoice with exactly that amount.
//
// A tag is unique per (price, time window). Two customers paying different
// prices never collide; two paying the same price get different tags; a tag is
// released once its invoice settles or expires.
// ─────────────────────────────────────────────────────────────────────────────

/** Statuses that still hold their tag: a transfer may yet arrive for them. */
export const TRON_OPEN_STATUSES: PaymentStatus[] = [
  PaymentStatus.PENDING,
  PaymentStatus.CONFIRMING,
  PaymentStatus.UNDERPAID
]

/**
 * How long a tag stays reserved past its payment window. Wallets sometimes
 * broadcast late and TronGrid indexes with a lag; handing the same tag to a new
 * invoice the second the old one expires would make a late transfer ambiguous.
 */
export const TRON_TAG_GRACE_MS = 30 * 60 * 1000

export class TronTagsExhaustedError extends Error {
  constructor() {
    super(`all ${TRON_TAG_MAX} USDT invoice tags are in use; try again in a few minutes`)
    this.name = 'TronTagsExhaustedError'
  }
}

/** Redis could not confirm the reservation; the checkout is refused rather than guessed. */
export class TronTagReservationError extends Error {
  constructor() {
    super('USDT invoice tag could not be reserved; payment method temporarily unavailable')
    this.name = 'TronTagReservationError'
  }
}

/** The configured receive address, or null when TRON is not (validly) set up. */
export function getTronReceiveAddress(): string | null {
  return resolveTronReceiveAddress(env)
}

function reservationKey(tag: number): string {
  return `tron:tag:${tag}`
}

function shuffled<T>(items: T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1)
    const tmp = out[i] as T
    out[i] = out[j] as T
    out[j] = tmp
  }
  return out
}

/**
 * Picks a sub-cent tag (1..99) no other open invoice for `amountCents` holds.
 *
 * Two layers guard uniqueness: the database (tags of every open TRON payment
 * for this price, still inside window + grace) and a Redis `SET NX` reservation
 * per (price, tag) that closes the race between two checkouts allocating in
 * the same instant — the row is only created after allocation returns. Redis
 * being unavailable degrades to the database check alone rather than blocking
 * checkout; the reservation is a tie-breaker, not the source of truth.
 */
export async function allocateTronTag(amountCents: number, windowMs: number): Promise<number> {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new RangeError(
      `allocateTronTag: amountCents must be a positive integer, got ${amountCents}`
    )
  }
  const holdMs = windowMs + TRON_TAG_GRACE_MS
  // The namespace is global, not per price: the worker resolves an inexact transfer by
  // tag alone, so two open invoices must never share one regardless of their amounts.
  // The database pass survives a Redis flush; the SET NX below closes the race between
  // two checkouts that both passed it before either row exists.
  const open = await prisma.payment.findMany({
    where: {
      provider: PaymentProvider.TRON_TRC20,
      status: { in: TRON_OPEN_STATUSES },
      createdAt: { gte: new Date(Date.now() - holdMs) }
    },
    select: { amount: true }
  })
  const taken = new Set(open.map((p) => tronTagOfAmountUsdt6(BigInt(p.amount))))
  const free: number[] = []
  for (let tag = 1; tag <= TRON_TAG_MAX; tag += 1) if (!taken.has(tag)) free.push(tag)
  if (free.length === 0) throw new TronTagsExhaustedError()
  for (const tag of shuffled(free)) {
    let reserved: string | null
    try {
      reserved = await redis.set(reservationKey(tag), '1', 'PX', holdMs, 'NX')
    } catch (err) {
      // Fail closed: an unreserved tag can be handed to two checkouts at once and the
      // worker would then have to guess whose money arrived. The buyer retries instead.
      logger.error({ err, tag }, 'TRON tag reservation failed: redis unavailable')
      throw new TronTagReservationError()
    }
    if (reserved === 'OK') return tag
  }
  throw new TronTagsExhaustedError()
}
