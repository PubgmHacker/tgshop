import { LedgerType, OrderStatus } from '@tgshop/db'
import { credit, type PrismaTx } from './ledger.js'
import { getSetting } from './settings.js'

// ─────────────────────────────────────────────────────────────────────────────
// Referrals.
//
// Two rules keep this from being farmable:
//   - the link is only attachable while User.referredById is still NULL (i.e.
//     on a genuine first /start), so nobody can re-attribute an existing user;
//   - the bonus pays out on the referee's FIRST paid order only, checked
//     against the orders table rather than a counter, so a refund-and-rebuy
//     loop cannot mint bonuses.
// ─────────────────────────────────────────────────────────────────────────────

/** Order statuses that count as "the user has actually bought something". */
const PAID_STATUSES: readonly OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.DELIVERING,
  OrderStatus.DELIVERED
]

/**
 * Attaches a referrer to a user. Returns whether the link was made.
 *
 * No-ops (returns false) on: unknown user or referrer, a user who already has a
 * referrer, self-referral, and the trivial A→B→A cycle.
 */
export async function attachReferrer(
  tx: PrismaTx,
  userId: string,
  referrerTgId: bigint
): Promise<boolean> {
  const user = await tx.user.findUnique({ where: { id: userId } })
  if (!user || user.referredById !== null) return false

  const referrer = await tx.user.findUnique({ where: { tgId: referrerTgId } })
  if (!referrer) return false
  if (referrer.id === user.id) return false
  if (referrer.referredById === user.id) return false

  await tx.user.update({
    where: { id: user.id },
    data: { referredById: referrer.id }
  })

  return true
}

/**
 * Credits the referrer their percentage of a referee's first paid order.
 * Returns the cents credited, 0 when no bonus applies.
 *
 * Guarded twice over: an existing REFERRAL ledger row for this order short-
 * circuits, and the credit itself is keyed `referral-bonus:<orderId>` so the
 * ledger's own idempotency is the final backstop against double payouts.
 */
export async function creditReferralBonus(tx: PrismaTx, orderId: string): Promise<number> {
  const order = await tx.order.findUnique({ where: { id: orderId } })
  if (!order) return 0
  if (!PAID_STATUSES.includes(order.status)) return 0

  const buyer = await tx.user.findUnique({ where: { id: order.userId } })
  const referrerId = buyer?.referredById
  if (!referrerId) return 0

  const alreadyPaid = await tx.balanceTransaction.count({
    where: { orderId: order.id, type: LedgerType.REFERRAL }
  })
  if (alreadyPaid > 0) return 0

  const priorPaidOrders = await tx.order.count({
    where: {
      userId: order.userId,
      status: { in: [...PAID_STATUSES] },
      id: { not: order.id }
    }
  })
  if (priorPaidOrders > 0) return 0

  const percent = await getSetting(tx, 'referral_percent')
  if (percent <= 0) return 0

  // Integer math, rounded DOWN: the shop never pays out a cent it did not take.
  const bonusCents = Math.floor((order.amountCents * percent) / 100)
  if (bonusCents <= 0) return 0

  await credit(tx, {
    userId: referrerId,
    amountCents: bonusCents,
    type: LedgerType.REFERRAL,
    orderId: order.id,
    idempotencyKey: `referral-bonus:${order.id}`,
    comment: `Referral bonus ${percent}% of order ${order.id}`
  })

  return bonusCents
}
