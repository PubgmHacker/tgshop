import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LedgerType, OrderStatus, PaymentProvider, StockStatus, SubStatus, type Order } from '@tgshop/db'
import {
  StockUnavailableError,
  createOrder,
  decrypt,
  fulfillOrder,
  type FulfillOutcome,
  type FulfillmentEmitter
} from '@tgshop/core'
import {
  createFixture,
  payOrderFromBalance,
  prisma,
  requireDefined,
  stockCounts,
  topUp,
  type TestFixture
} from './setup.js'

// ─────────────────────────────────────────────────────────────────────────────
// The worker's delivery path under concurrency.
//
// concurrent-delivery.test.ts proves core's deliver() — the stock claim itself.
// This file proves the layer the worker ACTUALLY calls: fulfillOrder(), which
// wraps that claim in the subscription row, the fail-and-refund settlement and
// the event emissions. apps/worker/src/queues/delivery.worker.ts is a thin
// adapter over exactly this function, so a race here is a race in production.
//
// It is a separate file because the wrapper has its own failure modes that
// deliver() cannot have:
//
//   • the subscription is created OUTSIDE the delivery transaction, so a retry
//     storm on one order could mint two Subscription rows for one purchase;
//   • the failure path credits a refund, so a retry storm on a sold-out order
//     could pay the same refund twice;
//   • events describe transitions, so a redelivery must announce nothing —
//     an order.delivered per retry would inflate every downstream counter.
//
// Each of those is a "second caller wins too" bug that only appears when two
// calls overlap, which is precisely what BullMQ does on a retry after a crash.
// ─────────────────────────────────────────────────────────────────────────────

const CONCURRENCY = 6
const RETRY_STORM = 4
const PRICE_CENTS = 250

interface CapturedEvents {
  delivered: string[]
  failed: { orderId: string; refundedCents: number }[]
  stockLow: string[]
  stockDepleted: string[]
}

/**
 * Event sink that records instead of publishing.
 *
 * Pushes are synchronous inside an async function, so no two concurrent callers
 * can interleave mid-push — the array is an exact, ordered record of what the
 * bus would have seen.
 */
function captureEmitter(): { events: CapturedEvents; emit: FulfillmentEmitter } {
  const events: CapturedEvents = { delivered: [], failed: [], stockLow: [], stockDepleted: [] }
  return {
    events,
    emit: {
      async orderDelivered(e) {
        events.delivered.push(e.orderId)
      },
      async orderFailed(e) {
        events.failed.push({ orderId: e.orderId, refundedCents: e.refundedCents })
      },
      async stockLow(e) {
        events.stockLow.push(e.planId)
      },
      async stockDepleted(e) {
        events.stockDepleted.push(e.planId)
      }
    }
  }
}

async function paidOrder(fixture: TestFixture, keySuffix: string): Promise<Order> {
  const order = await prisma.$transaction((tx) =>
    createOrder(tx, {
      userId: fixture.user.id,
      planId: fixture.plan.id,
      qty: 1,
      provider: PaymentProvider.BALANCE,
      idempotencyKey: fixture.key(keySuffix)
    })
  )
  return payOrderFromBalance(order)
}

describe('fulfillOrder() — the worker delivery path — under concurrency', () => {
  let fixture: TestFixture
  let orders: Order[]
  let soldOutOrder: Order
  let results: PromiseSettledResult<FulfillOutcome>[]
  let events: CapturedEvents

  beforeAll(async () => {
    fixture = await createFixture({ priceCents: PRICE_CENTS, stockCount: CONCURRENCY })
    // Funds every order in the file: the N concurrent ones, the sold-out one,
    // and the one the retry storm hammers.
    await topUp(fixture.user.id, PRICE_CENTS * (CONCURRENCY + 2), fixture.key('topup'))

    const created: Order[] = []
    for (let i = 0; i < CONCURRENCY; i++) {
      created.push(await paidOrder(fixture, `order-${i}`))
    }
    orders = created
    soldOutOrder = await paidOrder(fixture, 'order-soldout')

    const capture = captureEmitter()
    events = capture.events
    results = await Promise.allSettled(
      orders.map((order) => fulfillOrder(prisma, order.id, { emit: capture.emit }))
    )
  })

  afterAll(async () => {
    await fixture.cleanup()
  })

  it(`settles all ${CONCURRENCY} concurrent fulfilments`, () => {
    const rejections = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => String(r.reason))
    expect(rejections).toEqual([])
    for (const result of results) {
      expect(result.status).toBe('fulfilled')
      if (result.status === 'fulfilled') expect(result.value.status).toBe('delivered')
    }
  })

  it('hands out N distinct credentials and consumes exactly N items', async () => {
    const payloads = await Promise.all(
      orders.map(async (order) => {
        const stored = requireDefined(
          await prisma.order.findUnique({ where: { id: order.id } }),
          `order ${order.id}`
        )
        expect(stored.status).toBe(OrderStatus.DELIVERED)
        return decrypt(requireDefined(stored.deliveredPayloadEnc, 'deliveredPayloadEnc'))
      })
    )

    expect(new Set(payloads).size).toBe(CONCURRENCY)
    expect([...payloads].sort()).toEqual([...fixture.stockPlaintexts].sort())

    const counts = await stockCounts(fixture.plan.id)
    expect(counts[StockStatus.SOLD]).toBe(CONCURRENCY)
    expect(counts[StockStatus.AVAILABLE]).toBe(0)
    expect(counts[StockStatus.RESERVED]).toBe(0)
  })

  // The regression this file exists for: the worker used to deliver without ever
  // creating a Subscription, so a subscription plan bought on the TRON or
  // CryptoBot-poll rail had no period, no renewal and no reminders.
  it('creates exactly one ACTIVE subscription per delivered order', async () => {
    const subs = await prisma.subscription.findMany({ where: { userId: fixture.user.id } })
    expect(subs).toHaveLength(CONCURRENCY)
    expect(new Set(subs.map((s) => s.orderId)).size).toBe(CONCURRENCY)
    expect(subs.map((s) => s.orderId).sort()).toEqual(orders.map((o) => o.id).sort())
    for (const sub of subs) {
      expect(sub.status).toBe(SubStatus.ACTIVE)
      expect(sub.expiresAt.getTime()).toBeGreaterThan(sub.startsAt.getTime())
    }
  })

  it('announces each delivery exactly once', () => {
    expect(events.delivered).toHaveLength(CONCURRENCY)
    expect([...events.delivered].sort()).toEqual(orders.map((o) => o.id).sort())
    expect(events.failed).toEqual([])
  })

  // stock.low fires per delivery once the pool is at or below the threshold, so
  // the count is not fixed — but it must fire, and only for this plan. Silence
  // here would mean the shop sells out with no warning to the operator.
  it('warns that the pool ran down', () => {
    expect(events.stockLow.length).toBeGreaterThan(0)
    expect(new Set(events.stockLow)).toEqual(new Set([fixture.plan.id]))
  })

  // The pool is drawn to exactly zero above, so the sharper stock.depleted
  // signal (docs/AGENT_PLAN.md capability 2) must also fire, and only for this
  // plan. Which racer observes the zero is timing-dependent; that at least one
  // does is not.
  it('announces that the pool is empty', () => {
    expect(events.stockDepleted.length).toBeGreaterThan(0)
    expect(new Set(events.stockDepleted)).toEqual(new Set([fixture.plan.id]))
  })

  it('fails a sold-out order once, refunds it once, and announces it once', async () => {
    const capture = captureEmitter()
    const balanceBefore = await balanceOf(fixture.user.id)

    // The retry storm: BullMQ hands a job back after a crash, and a second
    // worker can pick it up while the first is still in flight. Every one of
    // these must reach the same conclusion without paying the refund twice.
    const stormed = await Promise.allSettled(
      Array.from({ length: RETRY_STORM }, () =>
        fulfillOrder(prisma, soldOutOrder.id, { emit: capture.emit })
      )
    )

    for (const result of stormed) {
      expect(result.status).toBe('rejected')
      if (result.status === 'rejected') expect(result.reason).toBeInstanceOf(StockUnavailableError)
    }

    const stored = requireDefined(
      await prisma.order.findUnique({ where: { id: soldOutOrder.id } }),
      'the sold-out order'
    )
    expect(stored.status).toBe(OrderStatus.FAILED)
    expect(stored.deliveredPayloadEnc).toBeNull()
    expect(await prisma.stockItem.count({ where: { orderId: soldOutOrder.id } })).toBe(0)

    // ONE refund row, whichever of the racers wrote it: every auto-refund path
    // shares the `delivery-failed-refund:<orderId>` idempotency key.
    const refunds = await prisma.balanceTransaction.findMany({
      where: { orderId: soldOutOrder.id, type: LedgerType.REFUND }
    })
    expect(refunds).toHaveLength(1)
    expect(requireDefined(refunds[0], 'the refund row').amountCents).toBe(PRICE_CENTS)
    expect(await balanceOf(fixture.user.id)).toBe(balanceBefore + PRICE_CENTS)

    // The event carries the money actually returned, read back from the ledger
    // rather than assumed, so a consumer reconciling refunds sees one payout.
    for (const failure of capture.events.failed) {
      expect(failure.orderId).toBe(soldOutOrder.id)
      expect(failure.refundedCents).toBe(PRICE_CENTS)
    }
    expect(capture.events.delivered).toEqual([])
  })

  it('is idempotent under a retry storm on an already-delivered order', async () => {
    const target = requireDefined(orders[0], 'the first delivered order')
    const capture = captureEmitter()
    const before = requireDefined(
      await prisma.order.findUnique({ where: { id: target.id } }),
      `order ${target.id}`
    )

    const stormed = await Promise.all(
      Array.from({ length: RETRY_STORM }, () =>
        fulfillOrder(prisma, target.id, { emit: capture.emit })
      )
    )

    for (const outcome of stormed) expect(outcome.status).toBe('delivered')

    // Nothing moved: same payload, same single stock item, same single
    // subscription — and, because a redelivery is not a transition, silence.
    const after = requireDefined(
      await prisma.order.findUnique({ where: { id: target.id } }),
      `order ${target.id} after the storm`
    )
    expect(after.deliveredPayloadEnc).toBe(before.deliveredPayloadEnc)
    expect(after.deliveredAt?.getTime()).toBe(before.deliveredAt?.getTime())
    expect(await prisma.stockItem.count({ where: { orderId: target.id } })).toBe(1)
    expect(await prisma.subscription.count({ where: { orderId: target.id } })).toBe(1)
    expect(capture.events.delivered).toEqual([])
    expect(capture.events.failed).toEqual([])
    expect(capture.events.stockLow).toEqual([])

    // And the pool is untouched by the storm.
    const counts = await stockCounts(fixture.plan.id)
    expect(counts[StockStatus.SOLD]).toBe(CONCURRENCY)
    expect(counts[StockStatus.AVAILABLE]).toBe(0)
  })
})

async function balanceOf(userId: string): Promise<number> {
  const result = await prisma.balanceTransaction.aggregate({
    where: { userId },
    _sum: { amountCents: true }
  })
  return result._sum.amountCents ?? 0
}
