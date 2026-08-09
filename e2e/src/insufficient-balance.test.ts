import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { OrderStatus, PaymentProvider, StockStatus, type Order } from '@tgshop/db'
import { InsufficientBalanceError, OrderStateError, createOrder, deliver } from '@tgshop/core'
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
// Paying more than you have must be a clean no-op, not a partial write.
//
// The debit and the status flip share one transaction, so the rollback is the
// whole point: no ledger row, no idempotency record, no PAID order, and — since
// delivery never runs — no stock consumed.
// ─────────────────────────────────────────────────────────────────────────────

const PRICE_CENTS = 1_999
const TOP_UP_CENTS = 500
const STOCK_COUNT = 2

describe('paying an order that exceeds the balance', () => {
  let fixture: TestFixture
  let order: Order
  let thrown: unknown

  beforeAll(async () => {
    fixture = await createFixture({ priceCents: PRICE_CENTS, stockCount: STOCK_COUNT })
    await topUp(fixture.user.id, TOP_UP_CENTS, fixture.key('topup'))

    order = await prisma.$transaction((tx) =>
      createOrder(tx, {
        userId: fixture.user.id,
        planId: fixture.plan.id,
        qty: 1,
        provider: PaymentProvider.BALANCE,
        idempotencyKey: fixture.key('order')
      })
    )

    try {
      await payOrderFromBalance(order)
      thrown = null
    } catch (error) {
      thrown = error
    }
  })

  afterAll(async () => {
    await fixture.cleanup()
  })

  it('throws InsufficientBalanceError', () => {
    expect(thrown).toBeInstanceOf(InsufficientBalanceError)
    expect((thrown as InsufficientBalanceError).message).toContain('insufficient balance')
  })

  it('leaves the order unpaid', async () => {
    const stored = requireDefined(await prisma.order.findUnique({ where: { id: order.id } }), 'the order')
    expect(stored.status).toBe(OrderStatus.PENDING)
    expect(stored.paidAt).toBeNull()
    expect(stored.deliveredPayloadEnc).toBeNull()
  })

  it('rolls the whole transaction back: no debit, no idempotency record', async () => {
    const entries = await prisma.balanceTransaction.findMany({ where: { userId: fixture.user.id } })
    expect(entries).toHaveLength(1) // the top-up, and nothing else
    expect(requireDefined(entries[0], 'the top-up entry').amountCents).toBe(TOP_UP_CENTS)

    const record = await prisma.idempotencyRecord.findUnique({ where: { key: `purchase:${order.id}` } })
    expect(record).toBeNull()
  })

  it('leaves the balance untouched', async () => {
    const sum = await prisma.balanceTransaction.aggregate({
      where: { userId: fixture.user.id },
      _sum: { amountCents: true }
    })
    expect(sum._sum.amountCents).toBe(TOP_UP_CENTS)
  })

  it('leaves the stock pool untouched', async () => {
    const counts = await stockCounts(fixture.plan.id)
    expect(counts[StockStatus.AVAILABLE]).toBe(STOCK_COUNT)
    expect(counts[StockStatus.SOLD]).toBe(0)
    expect(counts[StockStatus.RESERVED]).toBe(0)
  })

  it('refuses to deliver the unpaid order, still without touching stock', async () => {
    await expect(deliver(prisma, order.id)).rejects.toBeInstanceOf(OrderStateError)

    const counts = await stockCounts(fixture.plan.id)
    expect(counts[StockStatus.AVAILABLE]).toBe(STOCK_COUNT)
    expect(counts[StockStatus.SOLD]).toBe(0)
  })
})
