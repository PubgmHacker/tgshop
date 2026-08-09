import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LedgerType, OrderStatus, PaymentProvider, StockStatus, type Order } from '@tgshop/db'
import {
  OrderStateError,
  createOrder,
  deliver,
  getBalance,
  refundOrder,
  type DeliveryResult
} from '@tgshop/core'
import {
  createFixture,
  payOrderFromBalance,
  prisma,
  requireDefined,
  topUp,
  type TestFixture
} from './setup.js'

// ─────────────────────────────────────────────────────────────────────────────
// Refunding a delivered order.
//
// The money must come back to the cent — refunds land on the internal balance,
// so the ledger is the single source of truth — while the credential does NOT
// go back into the pool: it has already been handed to a customer and reselling
// it would deliver a burned account to the next buyer.
// ─────────────────────────────────────────────────────────────────────────────

const PRICE_CENTS = 2_499
const TOP_UP_CENTS = 5_000
const STOCK_COUNT = 2

describe('refunding a delivered order', () => {
  let fixture: TestFixture
  let order: Order
  let delivery: DeliveryResult
  let balanceBeforeRefund: number
  let balanceAfterRefund: number
  let refunded: Order

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
    await payOrderFromBalance(order)
    delivery = await deliver(prisma, order.id)

    balanceBeforeRefund = await getBalance(prisma, fixture.user.id)
    refunded = await prisma.$transaction((tx) => refundOrder(tx, order.id, 'customer changed their mind'))
    balanceAfterRefund = await getBalance(prisma, fixture.user.id)
  })

  afterAll(async () => {
    await fixture.cleanup()
  })

  it('marks the order REFUNDED', () => {
    expect(delivery.payload).toBeTruthy()
    expect(balanceBeforeRefund).toBe(TOP_UP_CENTS - PRICE_CENTS)
    expect(refunded.status).toBe(OrderStatus.REFUNDED)
  })

  it('returns exactly the order amount to the ledger, to the cent', async () => {
    expect(balanceAfterRefund).toBe(balanceBeforeRefund + PRICE_CENTS)
    expect(balanceAfterRefund).toBe(TOP_UP_CENTS)

    const refundRows = await prisma.balanceTransaction.findMany({
      where: { userId: fixture.user.id, type: LedgerType.REFUND }
    })
    expect(refundRows).toHaveLength(1)
    const row = requireDefined(refundRows[0], 'the refund ledger row')
    expect(row.amountCents).toBe(PRICE_CENTS)
    expect(row.orderId).toBe(order.id)
  })

  it('keeps the delivered credential burned instead of reselling it', async () => {
    const item = requireDefined(
      await prisma.stockItem.findFirst({ where: { orderId: order.id } }),
      'the sold stock item'
    )
    expect(item.status).toBe(StockStatus.SOLD)
    expect(item.orderId).toBe(order.id)

    const available = await prisma.stockItem.count({
      where: { planId: fixture.plan.id, status: StockStatus.AVAILABLE }
    })
    expect(available).toBe(STOCK_COUNT - 1)

    const stored = requireDefined(await prisma.order.findUnique({ where: { id: order.id } }), 'the order')
    expect(stored.deliveredPayloadEnc).not.toBeNull()
  })

  it('cannot be refunded twice — REFUNDED is terminal', async () => {
    await expect(
      prisma.$transaction((tx) => refundOrder(tx, order.id, 'double refund attempt'))
    ).rejects.toBeInstanceOf(OrderStateError)

    expect(await getBalance(prisma, fixture.user.id)).toBe(TOP_UP_CENTS)
    const refundRows = await prisma.balanceTransaction.count({
      where: { userId: fixture.user.id, type: LedgerType.REFUND }
    })
    expect(refundRows).toBe(1)
  })
})
