import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { OrderStatus, PaymentProvider, type Order } from '@tgshop/db'
import {
  ALLOWED_TRANSITIONS,
  OrderStateError,
  createOrder,
  deliver,
  expireOrder,
  markDelivered,
  markPaid,
  refundOrder
} from '@tgshop/core'
import { createFixture, prisma, requireDefined, type TestFixture } from './setup.js'

// ─────────────────────────────────────────────────────────────────────────────
// The state machine, exercised against real rows rather than a stubbed client.
//
// The graph itself is unit-tested in packages/core; what is worth proving here
// is that an illegal transition throws BEFORE it writes, so a rejected status
// change leaves no half-applied side effect in the database.
// ─────────────────────────────────────────────────────────────────────────────

describe('order state machine (real database)', () => {
  let fixture: TestFixture

  beforeAll(async () => {
    fixture = await createFixture({ priceCents: 1_299, stockCount: 1 })
  })

  afterAll(async () => {
    await fixture.cleanup()
  })

  async function newPendingOrder(suffix: string): Promise<Order> {
    return prisma.$transaction((tx) =>
      createOrder(tx, {
        userId: fixture.user.id,
        planId: fixture.plan.id,
        qty: 1,
        provider: PaymentProvider.BALANCE,
        idempotencyKey: fixture.key(`order-${suffix}`)
      })
    )
  }

  it('rejects PENDING → DELIVERED and leaves the row untouched', async () => {
    const order = await newPendingOrder('pending-delivered')

    const failure = prisma.$transaction((tx) => markDelivered(tx, order.id, 'v1:not:a:payload'))
    await expect(failure).rejects.toBeInstanceOf(OrderStateError)
    await expect(failure).rejects.toMatchObject({
      from: OrderStatus.PENDING,
      to: OrderStatus.DELIVERED,
      code: 'ORDER_STATE_ERROR'
    })

    const stored = requireDefined(await prisma.order.findUnique({ where: { id: order.id } }), 'the order')
    expect(stored.status).toBe(OrderStatus.PENDING)
    expect(stored.deliveredPayloadEnc).toBeNull()
    expect(stored.deliveredAt).toBeNull()
  })

  it('rejects PENDING → REFUNDED without writing a refund to the ledger', async () => {
    const order = await newPendingOrder('pending-refunded')

    await expect(
      prisma.$transaction((tx) => refundOrder(tx, order.id, 'never paid'))
    ).rejects.toBeInstanceOf(OrderStateError)

    const refunds = await prisma.balanceTransaction.count({ where: { orderId: order.id } })
    expect(refunds).toBe(0)
    const stored = requireDefined(await prisma.order.findUnique({ where: { id: order.id } }), 'the order')
    expect(stored.status).toBe(OrderStatus.PENDING)
  })

  it('refuses to deliver an order that was never paid', async () => {
    const order = await newPendingOrder('pending-deliver')
    await expect(deliver(prisma, order.id)).rejects.toBeInstanceOf(OrderStateError)
  })

  it('treats EXPIRED as terminal: an expired order can never be marked PAID', async () => {
    const order = await newPendingOrder('expired')
    const expired = await prisma.$transaction((tx) => expireOrder(tx, order.id))
    expect(expired.status).toBe(OrderStatus.EXPIRED)

    await expect(prisma.$transaction((tx) => markPaid(tx, order.id))).rejects.toBeInstanceOf(
      OrderStateError
    )

    const stored = requireDefined(await prisma.order.findUnique({ where: { id: order.id } }), 'the order')
    expect(stored.status).toBe(OrderStatus.EXPIRED)
    expect(stored.paidAt).toBeNull()
  })

  it('declares the terminal states with no outgoing edges', () => {
    expect(ALLOWED_TRANSITIONS[OrderStatus.EXPIRED]).toEqual([])
    expect(ALLOWED_TRANSITIONS[OrderStatus.REFUNDED]).toEqual([])
  })
})
