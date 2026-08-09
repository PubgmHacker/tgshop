import type { PrismaClient, Subscription } from '@tgshop/db'
import { LedgerType, OrderStatus, PaymentProvider, SubStatus } from '@tgshop/db'
import { debit, getBalance, type PrismaTx } from './ledger.js'
import { InsufficientBalanceError, OrderNotFoundError } from './errors.js'

// ─────────────────────────────────────────────────────────────────────────────
// Subscriptions: a Subscription row per paid Order of a plan that has a
// durationDays. Plans without durationDays are one-off purchases and never
// produce a subscription.
//
// Renewals STACK rather than restart: a new period starts at the current
// subscription's expiry (when still in the future), so a user who renews early
// never loses the days they already paid for.
// ─────────────────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Creates the Subscription for a paid order, or returns null when the plan is
 * not a subscription plan. Idempotent: Order.orderId is unique on Subscription,
 * so a second call returns the row created by the first.
 */
export async function createSubscriptionForOrder(
  tx: PrismaTx,
  orderId: string
): Promise<Subscription | null> {
  const existing = await tx.subscription.findUnique({ where: { orderId } })
  if (existing) return existing

  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: { plan: true }
  })
  if (!order) throw new OrderNotFoundError(orderId)

  const durationDays = order.plan.durationDays
  if (durationDays === null) return null

  const now = new Date()

  // Stack on top of the latest still-valid period for the same user+plan.
  const current = await tx.subscription.findFirst({
    where: { userId: order.userId, planId: order.planId, status: SubStatus.ACTIVE },
    orderBy: { expiresAt: 'desc' }
  })

  const paidAt = order.paidAt ?? now
  const base =
    current && current.expiresAt.getTime() > paidAt.getTime() ? current.expiresAt : paidAt
  const expiresAt = new Date(base.getTime() + durationDays * order.qty * DAY_MS)

  return tx.subscription.create({
    data: {
      userId: order.userId,
      planId: order.planId,
      orderId: order.id,
      startsAt: paidAt,
      expiresAt,
      status: SubStatus.ACTIVE
    }
  })
}

/** ACTIVE subscriptions expiring within the next `daysAhead` days, soonest first. */
export async function findExpiringSubscriptions(
  prisma: PrismaClient,
  daysAhead: number,
  now: Date = new Date()
): Promise<Subscription[]> {
  if (!Number.isFinite(daysAhead) || daysAhead < 0) {
    throw new RangeError(`findExpiringSubscriptions expects a non-negative daysAhead, got ${daysAhead}`)
  }
  const until = new Date(now.getTime() + daysAhead * DAY_MS)

  return prisma.subscription.findMany({
    where: {
      status: SubStatus.ACTIVE,
      expiresAt: { gte: now, lte: until }
    },
    orderBy: { expiresAt: 'asc' }
  })
}

/** Stamps the reminder clock so the next sweep does not re-notify the same user. */
export async function markReminded(
  tx: PrismaTx,
  subscriptionId: string,
  at: Date = new Date()
): Promise<void> {
  await tx.subscription.update({
    where: { id: subscriptionId },
    data: { remindedAt: at }
  })
}

/** Flips every ACTIVE subscription whose period has elapsed to EXPIRED. Returns the row count. */
export async function expireSubscriptions(
  prisma: PrismaClient,
  now: Date = new Date()
): Promise<number> {
  const result = await prisma.subscription.updateMany({
    where: { status: SubStatus.ACTIVE, expiresAt: { lte: now } },
    data: { status: SubStatus.EXPIRED }
  })
  return result.count
}

export type RenewFailureReason = 'insufficient_balance' | 'not_active' | 'plan_inactive'

export type RenewResult = { ok: true; orderId: string } | { ok: false; reason: RenewFailureReason }

/**
 * Renews a subscription out of the user's balance: debit, PAID order, stacked
 * period. All of it in one transaction — a crash must never take the money
 * without extending the subscription, or extend it for free.
 *
 * The debit's idempotency key includes the period being renewed, so a retried
 * job charges once per period while a genuine later renewal still goes through.
 */
export async function renewFromBalance(
  prisma: PrismaClient,
  subscriptionId: string
): Promise<RenewResult> {
  const sub = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: { plan: true }
  })

  if (!sub || sub.status !== SubStatus.ACTIVE) return { ok: false, reason: 'not_active' }
  if (!sub.plan.isActive) return { ok: false, reason: 'plan_inactive' }

  const priceCents = sub.plan.priceCents
  const balance = await getBalance(prisma, sub.userId)
  if (balance < priceCents) return { ok: false, reason: 'insufficient_balance' }

  const idempotencyKey = `sub-renew:${sub.id}:${sub.expiresAt.toISOString()}`
  const durationDays = sub.plan.durationDays ?? 30

  try {
    const orderId = await prisma.$transaction(async (tx) => {
      if (priceCents > 0) {
        await debit(tx, {
          userId: sub.userId,
          amountCents: priceCents,
          type: LedgerType.PURCHASE,
          idempotencyKey,
          comment: `Renew subscription ${sub.id}`
        })
      }

      const order = await tx.order.create({
        data: {
          userId: sub.userId,
          planId: sub.planId,
          qty: 1,
          amountCents: priceCents,
          currency: 'USD',
          provider: PaymentProvider.BALANCE,
          status: OrderStatus.PAID,
          idempotencyKey: `${idempotencyKey}:order`,
          paidAt: new Date()
        }
      })

      const startsAt = sub.expiresAt.getTime() > Date.now() ? sub.expiresAt : new Date()
      const expiresAt = new Date(startsAt.getTime() + durationDays * DAY_MS)

      // The old row is closed out before the new one is written so exactly one
      // ACTIVE subscription per user+plan remains true at every commit boundary.
      await tx.subscription.update({
        where: { id: sub.id },
        data: { status: SubStatus.EXPIRED }
      })
      await tx.subscription.create({
        data: {
          userId: sub.userId,
          planId: sub.planId,
          orderId: order.id,
          startsAt,
          expiresAt,
          autoRenew: sub.autoRenew,
          status: SubStatus.ACTIVE
        }
      })

      return order.id
    })

    return { ok: true, orderId }
  } catch (err) {
    // The balance read above is advisory; the ledger's advisory lock is what
    // actually decides, so a concurrent purchase can still lose the race here.
    if (err instanceof InsufficientBalanceError) {
      return { ok: false, reason: 'insufficient_balance' }
    }
    throw err
  }
}
