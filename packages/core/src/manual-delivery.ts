import type { Order, PrismaClient } from '@tgshop/db'
import { OrderStatus } from '@tgshop/db'
import { encrypt } from './crypto.js'
import { markDelivered, markDelivering } from './orders.js'
import { createSubscriptionForOrder } from './subscriptions.js'
import { OrderNotFoundError, OrderStateError } from './errors.js'

// ─────────────────────────────────────────────────────────────────────────────
// Manual delivery: an operator finishes a MANUAL_FALLBACK order by typing the
// credential in by hand.
//
// This is NOT redelivery. Redelivery re-attaches a payload the order already
// owns; a MANUAL_FALLBACK order parked in DELIVERING owns nothing — no
// deliveredPayloadEnc, no stock item — which is exactly why the redelivery
// policy rejects it. This module is the missing write path: it takes the
// operator's plaintext, encrypts it into the order, and runs the same
// post-delivery bookkeeping fulfillOrder() runs, so a manually delivered
// subscription plan still gets its Subscription row (profile visibility,
// expiry reminders, renewal) instead of silently losing its period.
//
// Lives in core rather than in the admin app so the state-machine rules and
// the subscription side effect are testable without Next.js, and so a second
// admin surface (a bot command, a support tool) inherits it.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Delivers an order by hand: encrypts the operator-supplied plaintext into
 * Order.deliveredPayloadEnc, marks the order DELIVERED and creates the
 * Subscription row when the plan is a subscription plan.
 *
 * Accepts orders in PAID or DELIVERING (where deliver() parks MANUAL_FALLBACK
 * work). An order already DELIVERED is returned untouched — the stored payload
 * is NEVER overwritten by a repeat submit — but its Subscription is repaired if
 * an earlier run died between delivery and bookkeeping, mirroring
 * fulfillOrder()'s idempotency.
 *
 * Two operators racing with different payloads cannot both win: the loser's
 * markDelivering() sees DELIVERED inside the transaction, throws
 * OrderStateError and rolls back, leaving the winner's payload intact.
 *
 * Throws on an empty payload — an all-whitespace credential is an operator
 * mistake, not a deliverable.
 */
export async function deliverManualOrder(
  prisma: PrismaClient,
  orderId: string,
  plaintextPayload: string
): Promise<Order> {
  const payload = plaintextPayload.trim()
  if (payload === '') {
    throw new Error(`manual delivery for order ${orderId} rejected: payload is empty`)
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } })
  if (!order) throw new OrderNotFoundError(orderId)

  if (order.status === OrderStatus.DELIVERED) {
    await prisma.$transaction((tx) => createSubscriptionForOrder(tx, orderId))
    return order
  }

  if (order.status !== OrderStatus.PAID && order.status !== OrderStatus.DELIVERING) {
    throw new OrderStateError(order.status, OrderStatus.DELIVERED)
  }

  return prisma.$transaction(async (tx) => {
    // PAID needs the DELIVERING hop first; already-DELIVERING is a no-op.
    await markDelivering(tx, orderId)
    const delivered = await markDelivered(tx, orderId, encrypt(payload))
    // Same transaction as the status write: a manually delivered subscription
    // must never exist half-done the way the old redeliver path left it.
    await createSubscriptionForOrder(tx, orderId)
    return delivered
  })
}
