import type { Order, PrismaClient } from '@tgshop/db'
import { LedgerType, OrderStatus } from '@tgshop/db'
import { credit } from './ledger.js'
import { countAvailable } from './stock.js'
import { deliver, isPoolBacked, type DeliveryDeps } from './delivery.js'
import { markFailed } from './orders.js'
import { createSubscriptionForOrder } from './subscriptions.js'
import {
  ManualFallbackRequiredError,
  OrderNotFoundError,
  OrderStateError
} from './errors.js'

// ─────────────────────────────────────────────────────────────────────────────
// Fulfilment: everything that must happen around core's deliver() once an order
// is PAID — the subscription row, the failure/refund settlement, and the facts
// worth announcing to the event bus.
//
// This module exists because that "around" used to be duplicated. apps/bot had
// one copy and apps/worker had another, and the two answered differently for
// the same order:
//
//   • the worker routed UNIQUE_CODE products to the stock pool and never read
//     externalConfig.codeTemplate, so a template-minted product succeeded when
//     paid with Stars and failed-and-refunded when paid with USDT;
//   • the worker matched only RESERVED stock when resuming, so a crash between
//     its stock transaction and its DELIVERED write left the item SOLD and
//     unfindable — every retry then hit the orderId unique index, exhausted its
//     attempts, and refunded an order whose credential was already burned;
//   • the worker never created a Subscription, so a subscription plan paid on
//     the TRON rail delivered a credential with no period, renewal or reminder.
//
// The delivery mechanics themselves live in delivery.ts. This is the layer
// above: the sequence a caller must not get wrong, in one place, so a new
// payment rail inherits it instead of reimplementing it.
//
// ── WHAT CALLERS STILL OWN ───────────────────────────────────────────────────
// Side effects that need a framework — messaging the buyer over Telegram,
// alerting admins — stay with the caller. This module takes an optional
// `emit` for domain events and otherwise touches nothing but the database, so
// it remains callable from the bot, the worker, and tests alike.
//
// ── TRANSACTIONS ─────────────────────────────────────────────────────────────
// `prisma` here is the CLIENT, never a transaction. deliver() opens its own
// transaction for the stock claim, and the row lock taken by FOR UPDATE SKIP
// LOCKED must be held until that transaction commits. Nesting it inside a
// caller's transaction would give up the guarantee that stops two buyers from
// receiving one credential.
// ─────────────────────────────────────────────────────────────────────────────

/** Domain events this module announces. Wired to publishEvent() by the caller. */
export interface FulfillmentEmitter {
  orderDelivered(e: {
    orderId: string
    userId: string
    planId: string
    deliveredAt: string
  }): Promise<void>
  orderFailed(e: {
    orderId: string
    userId: string
    reason: string
    refundedCents: number
  }): Promise<void>
  stockLow(e: {
    planId: string
    productId: string
    available: number
    threshold: number
  }): Promise<void>
  stockDepleted(e: {
    planId: string
    productId: string
  }): Promise<void>
}

export interface FulfillOptions extends DeliveryDeps {
  /** Domain-event sink. Omitted in contexts with no bus (tests, one-off scripts). */
  emit?: Partial<FulfillmentEmitter>
  /** Structured logging seam; defaults to silence rather than console noise. */
  onWarning?: (message: string, context: Record<string, unknown>) => void
}

export type FulfillOutcome =
  /** Delivered — `order` carries the payload ciphertext. */
  | { status: 'delivered'; order: Order }
  /** A MANUAL_FALLBACK product: left DELIVERING on purpose, an admin finishes it. */
  | { status: 'manual'; order: Order }

/**
 * Delivers a PAID/DELIVERING order and performs every follow-up step.
 *
 * Returns `manual` for MANUAL_FALLBACK products — not a failure; the caller
 * should alert an admin and leave the order alone.
 *
 * Throws whatever delivery threw, AFTER the order has been marked FAILED and the
 * buyer refunded, so callers can surface a sold-out/failed message. The one
 * exception is an order that was never deliverable to begin with (already
 * EXPIRED/REFUNDED, or missing): that took no money for this attempt, so it is
 * re-thrown untouched rather than being credited out of a caller's mistake.
 *
 * Idempotent end to end. Re-running a DELIVERED order consumes no second stock
 * item, re-announces nothing, and repairs a missing Subscription row left by an
 * earlier run that died between delivery and bookkeeping.
 */
export async function fulfillOrder(
  prisma: PrismaClient,
  orderId: string,
  opts: FulfillOptions = {}
): Promise<FulfillOutcome> {
  const before = await prisma.order.findUnique({ where: { id: orderId } })
  if (!before) throw new OrderNotFoundError(orderId)
  const alreadyDelivered = before.status === OrderStatus.DELIVERED

  try {
    await deliver(prisma, orderId, opts)
  } catch (err) {
    if (err instanceof ManualFallbackRequiredError) {
      return { status: 'manual', order: await requireOrder(prisma, orderId) }
    }
    return settleFailedDelivery(prisma, orderId, err, opts)
  }

  const delivered = await requireOrder(prisma, orderId)

  // Post-delivery bookkeeping. The payload is already committed to the order
  // row, so nothing below may throw its way back to the caller and turn a
  // completed purchase into an error the buyer sees.
  try {
    // Idempotent in core (Subscription.orderId is unique), so this also repairs
    // an earlier run that crashed between delivery and subscription creation.
    await prisma.$transaction((tx) => createSubscriptionForOrder(tx, orderId))

    // Events describe transitions, not readings: re-delivering an order that was
    // already DELIVERED (a resent webhook) is not a new delivery, and it did not
    // consume a stock item either, so neither event applies.
    if (!alreadyDelivered) {
      await opts.emit?.orderDelivered?.({
        orderId: delivered.id,
        userId: delivered.userId,
        planId: delivered.planId,
        deliveredAt: (delivered.deliveredAt ?? new Date()).toISOString()
      })
      await emitStockLevels(prisma, delivered.planId, opts)
    }
  } catch (err) {
    opts.onWarning?.('post-delivery bookkeeping failed; order is delivered', {
      err,
      orderId
    })
  }

  return { status: 'delivered', order: delivered }
}

/**
 * Marks a failed delivery FAILED, refunds it, announces it, and re-throws the
 * original cause so the caller can tell the buyer what went wrong.
 */
async function settleFailedDelivery(
  prisma: PrismaClient,
  orderId: string,
  cause: unknown,
  opts: FulfillOptions
): Promise<never> {
  // An order that was never deliverable — already EXPIRED or REFUNDED, or never
  // paid — took no money for this attempt. Marking it FAILED and crediting it
  // here would invent a payout out of a caller's mistake.
  if (cause instanceof OrderStateError || cause instanceof OrderNotFoundError) throw cause

  const reason = cause instanceof Error ? cause.message : String(cause)

  try {
    await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId } })
      if (!order) return

      // core's EXTERNAL_API path already fails AND refunds the order itself
      // before throwing. Re-running that here would attempt an illegal
      // FAILED -> FAILED transition, so only settle an order still in flight.
      if (order.status !== OrderStatus.PAID && order.status !== OrderStatus.DELIVERING) return

      // markFailed() also returns any stock merely RESERVED for this order to
      // the pool and writes the audit row — another reason not to hand-roll it.
      await markFailed(tx, orderId, reason)

      // The money already left the buyer's balance, so the only acceptable end
      // state is "refunded". Every auto-refund path in the system shares this
      // one key, so however many of them run, the user is credited exactly once.
      if (order.amountCents > 0) {
        await credit(tx, {
          userId: order.userId,
          amountCents: order.amountCents,
          type: LedgerType.REFUND,
          orderId,
          idempotencyKey: `delivery-failed-refund:${orderId}`,
          comment: `Auto-refund: delivery failed (${reason})`
        })
      }
    })
  } catch (settleErr) {
    // Never let a bookkeeping error mask the delivery error the caller needs to
    // see and act on.
    opts.onWarning?.('could not mark a failed delivery FAILED/refunded', {
      err: settleErr,
      orderId
    })
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } })
  if (order) {
    await opts.emit
      ?.orderFailed?.({
        orderId,
        userId: order.userId,
        reason,
        // Read back rather than assumed: core may have issued the refund itself.
        refundedCents: await refundedCentsFor(prisma, orderId)
      })
      .catch((emitErr: unknown) => {
        opts.onWarning?.('could not publish order.failed', { err: emitErr, orderId })
      })
  }

  throw cause
}

/**
 * Announces stock.low when a delivery has drawn a pool down to (or below) the
 * plan's own threshold, and stock.depleted when it has drawn it to zero.
 *
 * Only pool-backed plans have a finite level. An EXTERNAL_API plan — or a
 * UNIQUE_CODE plan that mints codes from a template — would otherwise report
 * zero available forever and fire this alert on every single sale.
 *
 * At zero BOTH events fire: stock.low keeps its "at or below threshold"
 * contract for consumers that only watch it, and stock.depleted is the
 * distinct, sharper signal docs/AGENT_PLAN.md routes to a human decision
 * (disable? restock?) rather than a promo post.
 */
async function emitStockLevels(
  prisma: PrismaClient,
  planId: string,
  opts: FulfillOptions
): Promise<void> {
  if (!opts.emit?.stockLow && !opts.emit?.stockDepleted) return

  const plan = await prisma.plan.findUnique({
    where: { id: planId },
    select: {
      id: true,
      productId: true,
      lowStockThreshold: true,
      product: { select: { deliveryType: true, externalConfig: true } }
    }
  })
  if (!plan) return
  if (!isPoolBacked(plan.product.deliveryType, plan.product.externalConfig)) return

  const available = await countAvailable(prisma, plan.id)
  if (available > plan.lowStockThreshold) return

  await opts.emit?.stockLow?.({
    planId: plan.id,
    productId: plan.productId,
    available,
    threshold: plan.lowStockThreshold
  })

  if (available === 0) {
    await opts.emit?.stockDepleted?.({
      planId: plan.id,
      productId: plan.productId
    })
  }
}

/** Total already credited back for an order, whoever issued it. */
export async function refundedCentsFor(prisma: PrismaClient, orderId: string): Promise<number> {
  const result = await prisma.balanceTransaction.aggregate({
    where: { orderId, type: LedgerType.REFUND },
    _sum: { amountCents: true }
  })
  return result._sum.amountCents ?? 0
}

async function requireOrder(prisma: PrismaClient, orderId: string): Promise<Order> {
  const order = await prisma.order.findUnique({ where: { id: orderId } })
  if (!order) throw new OrderNotFoundError(orderId)
  return order
}
