import { prisma, LedgerType, OrderStatus, PaymentProvider } from '@tgshop/db'
import type { Order, Prisma } from '@tgshop/db'
import {
  computeOrderTotal,
  createOrder as coreCreateOrder,
  creditReferralBonus,
  debit,
  decrypt,
  encrypt,
  expireOrder,
  fulfillOrder,
  markPaid,
  renewFromBalance,
  DeliveryFailedError,
  OrderNotFoundError,
  type FulfillmentEmitter,
  type PricingBreakdown,
  type RenewResult
} from '@tgshop/core'
import { emitEvent } from './events.js'
import { externalSupplier } from './supplier.js'
import { logger } from '../lib/logger.js'
import { newId } from '../lib/ids.js'

// ─────────────────────────────────────────────────────────────────────────────
// Order lifecycle — a THIN adapter over @tgshop/core.
//
// This file used to carry a second, private copy of the pipeline, and the copy
// had drifted into a double-selling bug: it claimed stock with findFirst +
// update, which hands the same StockItem to every concurrent buyer that reads
// before the first one writes. Everything that decides who gets which goods, or
// what an order is allowed to do next, now lives in core and only in core:
//
//   stock claiming     core deliver()        SELECT … FOR UPDATE SKIP LOCKED
//   state transitions  core ALLOWED_TRANSITIONS via markPaid/markFailed/…
//   promo counting     core createOrder() / expireOrder() / refundOrder()
//   pricing            core computeOrderTotal()
//   delivery + refund  core fulfillOrder()
//   subscriptions      core createSubscriptionForOrder(), via fulfillOrder()
//   referral bonuses   core creditReferralBonus()
//
// What is left here is adaptation: opening transactions, shaping results for the
// bot's callers, and publishing domain events once a transaction has committed.
//
// ── TRANSACTION CONTRACT ─────────────────────────────────────────────────────
// The one thing that is easy to get silently wrong, because both spellings
// compile:
//
//   • core's order mutators (createOrder, markPaid, markFailed, expireOrder,
//     creditReferralBonus, credit/debit) take a TRANSACTION CLIENT. They must be
//     handed the `tx` from prisma.$transaction() so their reads and writes commit
//     or roll back as one unit.
//
//   • core's fulfillOrder()/deliver() take the PRISMA CLIENT. Delivery opens its
//     own transaction for the stock claim because the row lock taken by FOR
//     UPDATE SKIP LOCKED has to be held until that transaction commits. Handing
//     it a `tx` would nest a transaction inside a transaction and give up exactly
//     the guarantee that makes double-selling impossible.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The bot's wiring into core's fulfilment pipeline: the external-API supplier,
 * the domain-event sink, and structured logging. Shared by every settle path so
 * a Stars purchase and a balance purchase cannot diverge.
 */
const fulfillOptions = {
  supplier: externalSupplier,
  emit: {
    orderDelivered: (e) => emitEvent('order.delivered', e),
    orderFailed: (e) => emitEvent('order.failed', e),
    stockLow: (e) => emitEvent('stock.low', e)
  } satisfies FulfillmentEmitter,
  onWarning: (message: string, context: Record<string, unknown>): void => {
    logger.error(context, message)
  }
}

export interface CreateOrderInput {
  userId: string
  planId: string
  qty: number
  provider: PaymentProvider
  promoCode?: string | null
  idempotencyKey: string
}

export interface CreateOrderResult {
  order: Order
  pricing: PricingBreakdown
}

/**
 * Creates a PENDING order for a plan purchase.
 *
 * Idempotent on idempotencyKey, including against a concurrent duplicate: core
 * races on the unique index rather than on a read, so the loser re-reads the
 * winner's row and both callers get the same single order.
 *
 * Note that core also claims one use of a capped promo here, atomically. That is
 * why this must not be re-implemented locally: a check-then-increment lets two
 * concurrent buyers both spend the last use of a maxUses=1 code.
 */
export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  const order = await prisma.$transaction((tx) =>
    coreCreateOrder(tx, {
      userId: input.userId,
      planId: input.planId,
      qty: input.qty,
      provider: input.provider,
      promoCode: input.promoCode ?? undefined,
      idempotencyKey: input.idempotencyKey
    })
  )

  return { order, pricing: await pricingForOrder(order) }
}

/**
 * Rebuilds the price breakdown of an order that already exists.
 *
 * computeOrderTotal() is deliberately called WITHOUT the promo: passing it would
 * re-run validatePromo(), which throws as soon as this very order's own claim
 * pushed usedCount up to maxUses — rejecting a perfectly valid order because it
 * was the one that consumed the last use. The plan-level arithmetic still comes
 * from core; only the promo discount is derived, by subtracting the order's
 * stored amountCents, which is the authoritative price core actually charged.
 */
async function pricingForOrder(order: Order): Promise<PricingBreakdown> {
  const plan = await prisma.plan.findUniqueOrThrow({ where: { id: order.planId } })
  const promo = order.promoId
    ? await prisma.promo.findUnique({ where: { id: order.promoId } })
    : null

  const base = computeOrderTotal(plan, order.qty, null)

  return {
    ...base,
    promoCode: promo?.code ?? null,
    promoDiscountCents: base.subtotalCents - order.amountCents,
    totalCents: order.amountCents
  }
}

/**
 * Marks an order PAID (from any payment provider) and immediately delivers it.
 *
 * Idempotent end to end: core's markPaid() returns an already-PAID/DELIVERING/
 * DELIVERED order untouched, and deliver() returns the stored payload without
 * consuming a second stock item. A provider that resends its webhook therefore
 * costs nothing.
 */
export async function markOrderPaidAndDeliver(orderId: string): Promise<Order> {
  const { order, transitioned } = await prisma.$transaction((tx) => markPaidTracked(tx, orderId))

  // After the commit, never inside it: an order.paid event for a transaction
  // that rolled back would be a fact the consumer cannot un-learn.
  if (transitioned) await emitOrderPaid(order)

  return deliverAndSettle(orderId)
}

/**
 * Pays an order out of the user's balance ledger, then delivers it.
 *
 * ── Why a user can never be charged without receiving goods ──────────────────
 *
 *  1. The debit and markPaid() share ONE transaction. Money leaves the ledger if
 *     and only if the order becomes PAID; a crash between them rolls back both.
 *
 *  2. Delivery runs only after that transaction has committed, inside core's own
 *     transaction. It has to be a separate one: the stock claim holds a row lock
 *     until commit, so nesting it inside the payment transaction would either
 *     stretch that lock across the whole payment or lose SKIP LOCKED entirely —
 *     and SKIP LOCKED is the thing that stops two buyers getting one credential.
 *
 *  3. Delivery is therefore the only step that can fail with the money already
 *     taken, and every one of its failure paths ends in a refund:
 *     settleFailedDelivery() marks the order FAILED and credits the amount back
 *     in a single transaction, and core's own EXTERNAL_API exhaustion path does
 *     the same before it throws. Both use the idempotency key
 *     `delivery-failed-refund:<orderId>`, so however many of them run, the user
 *     is credited exactly once.
 *
 *  4. If the process dies between (1) and (3), the order is left PAID — a
 *     resumable state. deliver() is idempotent, so re-running this order (from
 *     the worker's delivery job, or a repeat call here) either delivers it or
 *     refunds it. A second charge is impossible because the debit is keyed
 *     `purchase:<orderId>`.
 *
 * The net effect: at every instant the user either still has their money, or has
 * the goods, or is queued to get one of the two back.
 */
export async function payOrderFromBalance(order: Order): Promise<Order> {
  const { order: paid, transitioned } = await prisma.$transaction(async (tx) => {
    // A 100%-discounted order costs nothing; core's debit() rejects a
    // non-positive amount, so there is simply nothing to charge.
    if (order.amountCents > 0) {
      await debit(tx, {
        userId: order.userId,
        amountCents: order.amountCents,
        type: LedgerType.PURCHASE,
        orderId: order.id,
        idempotencyKey: `purchase:${order.id}`,
        comment: `Purchase ${order.id}`
      })
    }
    return markPaidTracked(tx, order.id)
  })

  if (transitioned) await emitOrderPaid(paid)

  return deliverAndSettle(order.id)
}

/**
 * Delivers a PAID/DELIVERING order and returns its refreshed row.
 *
 * Throws whatever core threw when delivery genuinely failed — after the order
 * has been marked FAILED and the buyer refunded — so callers can surface a
 * sold-out or delivery-failed message. A MANUAL_FALLBACK order is NOT a failure
 * and comes back as a normal DELIVERING row.
 */
export async function deliverOrder(orderId: string): Promise<Order> {
  return deliverAndSettle(orderId)
}

/**
 * The single delivery path for the whole bot: core's fulfillOrder(), which owns
 * delivery, the subscription row, the fail-and-refund settlement, and the domain
 * events. apps/worker calls the very same function, so a purchase settles
 * identically whichever rail paid for it.
 *
 * `prisma` — the client, not a transaction — is passed on purpose; see the
 * transaction contract at the top of this file.
 */
async function deliverAndSettle(orderId: string): Promise<Order> {
  const outcome = await fulfillOrder(prisma, orderId, fulfillOptions)

  if (outcome.status === 'manual') {
    // Not a failure. core leaves the order in DELIVERING deliberately and an
    // admin completes it out of band, so there is nothing to fail or refund.
    logger.warn({ orderId }, 'order requires manual delivery by an admin')
  }

  return outcome.order
}

/**
 * Runs core's markPaid() inside `tx` and reports whether THIS call is the one
 * that flipped the order.
 *
 * markPaid is idempotent by design because providers resend webhooks — which
 * means a replay returns the order untouched, and a replay must not re-announce
 * `order.paid` to the bus as though a second payment had arrived.
 */
async function markPaidTracked(
  tx: Prisma.TransactionClient,
  orderId: string
): Promise<{ order: Order; transitioned: boolean }> {
  const before = await tx.order.findUnique({ where: { id: orderId }, select: { status: true } })
  if (!before) throw new OrderNotFoundError(orderId)

  const order = await markPaid(tx, orderId)
  return { order, transitioned: before.status !== order.status }
}

async function emitOrderPaid(order: Order): Promise<void> {
  await emitEvent('order.paid', {
    orderId: order.id,
    userId: order.userId,
    planId: order.planId,
    provider: order.provider,
    amountCents: order.amountCents
  })
}

/** Decrypts an order's delivered payload for display to its owner. Throws if not yet delivered. */
export function decryptDeliveredPayload(order: Order): string {
  if (!order.deliveredPayloadEnc) {
    throw new DeliveryFailedError(order.id, 'no delivered payload present')
  }
  return decrypt(order.deliveredPayloadEnc)
}

/** Encrypts a raw stock payload for storage, matching the seed.ts / core format. */
export function encryptStockPayload(plaintext: string): string {
  return encrypt(plaintext)
}

/**
 * Expires PENDING orders past their deadline, one core expireOrder() per order.
 *
 * Deliberately NOT the single bulk `updateMany` this used to be. Expiry has to
 * return reserved stock to the pool and hand back the promo use the order
 * claimed at creation, and only core's expireOrder() does both. A bulk status
 * flip silently burns a use of a capped promo code on an order nobody paid for.
 */
export async function expirePendingOrders(): Promise<number> {
  const due = await prisma.order.findMany({
    where: { status: OrderStatus.PENDING, expiresAt: { lt: new Date() } },
    select: { id: true }
  })

  let expired = 0
  for (const { id } of due) {
    try {
      await prisma.$transaction((tx) => expireOrder(tx, id))
      expired += 1
    } catch (err) {
      // A payment may have moved the order out of PENDING between the scan and
      // this transaction. Losing that race is correct behaviour, not an outage.
      logger.warn({ err, orderId: id }, 'could not expire order')
    }
  }

  return expired
}

export async function getOrderById(orderId: string) {
  return prisma.order.findUnique({ where: { id: orderId }, include: { plan: { include: { product: true } } } })
}

export async function listUserOrders(userId: string, limit = 20) {
  return prisma.order.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { plan: { include: { product: true } } }
  })
}

export async function listUserSubscriptions(userId: string) {
  return prisma.subscription.findMany({
    where: { userId },
    orderBy: { expiresAt: 'desc' },
    include: { plan: { include: { product: true } } }
  })
}

export async function getSubscriptionForUser(subscriptionId: string, userId: string) {
  // Scoped by userId, not just id: the subscription id travels in callback data,
  // which the client controls, so an id belonging to someone else must read as
  // "not found" rather than as a subscription this user may spend money on.
  return prisma.subscription.findFirst({
    where: { id: subscriptionId, userId },
    include: { plan: { include: { product: true } } }
  })
}

/**
 * The subscription period a renewal order bought.
 *
 * Renewing does not extend the existing row — core closes it out as EXPIRED and
 * writes a fresh ACTIVE one — so the only handle on the new period is the order
 * that paid for it (`Subscription.orderId` is unique).
 */
export async function getSubscriptionByOrderId(orderId: string) {
  return prisma.subscription.findUnique({ where: { orderId } })
}

/**
 * Renews one subscription period from the user's internal balance.
 *
 * Straight through to core, which owns the debit, the order, the period stacking
 * and — critically — the idempotency key. The worker's hourly auto-renew sweep
 * calls the SAME function, so a user tapping "Renew" at the moment the sweep is
 * renewing the same period is deduplicated by the ledger instead of being
 * charged twice.
 */
export async function renewSubscriptionFromBalance(subscriptionId: string): Promise<RenewResult> {
  return renewFromBalance(prisma, subscriptionId)
}

/**
 * Credits the referrer their share of a first-time buyer's order.
 *
 * Delegates to core, which owns the eligibility rules (the referee's FIRST paid
 * order only, checked against the orders table so a refund-and-rebuy loop cannot
 * mint bonuses) and reads the payout percentage from the `referral_percent`
 * setting.
 *
 * The old `referralPercent = 10` parameter is gone rather than kept and ignored:
 * it hardcoded a rate that silently overrode whatever an admin had configured.
 * No caller ever passed it.
 */
export async function creditReferralBonusIfEligible(order: Order): Promise<void> {
  const bonusCents = await prisma.$transaction((tx) => creditReferralBonus(tx, order.id))
  if (bonusCents > 0) {
    logger.info({ orderId: order.id, bonusCents }, 'referral bonus credited')
  }
}

export function newIdempotencyKey(prefix: string): string {
  return `${prefix}:${newId()}`
}

export type { Prisma }
