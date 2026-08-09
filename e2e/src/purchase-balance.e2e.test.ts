import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { OrderStatus, PaymentProvider, StockStatus, type Order, type StockItem } from '@tgshop/db'
import { createOrder, decrypt, deliver, getBalance, type DeliveryResult } from '@tgshop/core'
import { createFixture, payOrderFromBalance, prisma, requireDefined, topUp, type TestFixture } from './setup.js'

// ─────────────────────────────────────────────────────────────────────────────
// THE end-to-end test: top up → order → pay from balance → deliver → delivered.
//
// Every step runs against the real Postgres through the real @tgshop/core API;
// nothing is stubbed. The flow executes once in beforeAll and each invariant
// gets its own named assertion, so a failure names the invariant that broke
// rather than "the e2e test".
// ─────────────────────────────────────────────────────────────────────────────

const TOP_UP_CENTS = 5_000
const PRICE_CENTS = 1_999
const STOCK_COUNT = 3

describe('E2E: buy with balance → delivered', () => {
  let fixture: TestFixture
  let order: Order
  let finalOrder: Order
  let firstDelivery: DeliveryResult
  let secondDelivery: DeliveryResult
  let balanceAfterTopUp: number
  let balanceAfterPurchase: number
  let balanceAfterSecondDeliver: number
  let soldItems: StockItem[]

  beforeAll(async () => {
    fixture = await createFixture({ priceCents: PRICE_CENTS, stockCount: STOCK_COUNT })

    // 1. Money in, through the ledger.
    balanceAfterTopUp = await topUp(fixture.user.id, TOP_UP_CENTS, fixture.key('topup'))

    // 2. An order for the STOCK_POOL plan.
    order = await prisma.$transaction((tx) =>
      createOrder(tx, {
        userId: fixture.user.id,
        planId: fixture.plan.id,
        qty: 1,
        provider: PaymentProvider.BALANCE,
        idempotencyKey: fixture.key('order')
      })
    )

    // 3. Settle it from the balance (debit + markPaid in one transaction).
    await payOrderFromBalance(order)
    balanceAfterPurchase = await getBalance(prisma, fixture.user.id)

    // 4. Deliver, then deliver again to probe idempotency.
    firstDelivery = await deliver(prisma, order.id)
    secondDelivery = await deliver(prisma, order.id)
    balanceAfterSecondDeliver = await getBalance(prisma, fixture.user.id)

    finalOrder = requireDefined(
      await prisma.order.findUnique({ where: { id: order.id } }),
      'order after delivery'
    )
    soldItems = await prisma.stockItem.findMany({
      where: { planId: fixture.plan.id, status: StockStatus.SOLD }
    })
  })

  afterAll(async () => {
    await fixture.cleanup()
  })

  it('prices the order at the plan price in integer cents', () => {
    expect(order.amountCents).toBe(PRICE_CENTS)
    expect(Number.isInteger(order.amountCents)).toBe(true)
    expect(order.status).toBe(OrderStatus.PENDING)
    expect(balanceAfterTopUp).toBe(TOP_UP_CENTS)
  })

  it('drives the order all the way to DELIVERED', () => {
    expect(finalOrder.status).toBe(OrderStatus.DELIVERED)
    expect(finalOrder.paidAt).toBeInstanceOf(Date)
    expect(finalOrder.deliveredAt).toBeInstanceOf(Date)
  })

  it('moves exactly one StockItem AVAILABLE → SOLD and binds it to the order', async () => {
    expect(soldItems).toHaveLength(1)

    const sold = requireDefined(soldItems[0], 'the sold stock item')
    expect(sold.orderId).toBe(order.id)
    expect(sold.status).toBe(StockStatus.SOLD)
    expect(sold.reservedUntil).toBeNull()

    // The rest of the pool is untouched.
    const available = await prisma.stockItem.count({
      where: { planId: fixture.plan.id, status: StockStatus.AVAILABLE }
    })
    expect(available).toBe(STOCK_COUNT - 1)
  })

  it('delivers a payload that decrypts to the original plaintext', () => {
    const sold = requireDefined(soldItems[0], 'the sold stock item')
    expect(firstDelivery.payload).toBe(decrypt(sold.payloadEnc))
    expect(fixture.stockPlaintexts).toContain(firstDelivery.payload)
    expect(firstDelivery.instructions).toBeTruthy()
  })

  it('debits the ledger by exactly the order total, with no cent of drift', async () => {
    expect(balanceAfterPurchase).toBe(TOP_UP_CENTS - PRICE_CENTS)
    expect(balanceAfterPurchase).toBe(balanceAfterTopUp - order.amountCents)
    expect(Number.isInteger(balanceAfterPurchase)).toBe(true)

    const entries = await prisma.balanceTransaction.findMany({
      where: { userId: fixture.user.id },
      orderBy: { createdAt: 'asc' }
    })
    expect(entries).toHaveLength(2)
    const purchase = requireDefined(
      entries.find((entry) => entry.orderId === order.id),
      'the purchase ledger entry'
    )
    // Debits are stored as the negative of the amount taken.
    expect(purchase.amountCents).toBe(-PRICE_CENTS)
    expect(entries.reduce((sum, entry) => sum + entry.amountCents, 0)).toBe(balanceAfterPurchase)
  })

  it('stores deliveredPayloadEnc, which decrypts to the delivered payload', () => {
    const stored = requireDefined(finalOrder.deliveredPayloadEnc, 'Order.deliveredPayloadEnc')
    expect(stored).toMatch(/^v1:/)
    expect(decrypt(stored)).toBe(firstDelivery.payload)

    // Re-encrypted rather than copied: the order carries its own ciphertext, so
    // the stored blob differs byte-wise from the stock item's even though both
    // decrypt to the same secret.
    const sold = requireDefined(soldItems[0], 'the sold stock item')
    expect(stored).not.toBe(sold.payloadEnc)
  })

  it('is idempotent: a second deliver() repeats the payload and consumes no second item', async () => {
    expect(secondDelivery.payload).toBe(firstDelivery.payload)
    expect(secondDelivery.instructions).toBe(firstDelivery.instructions)

    const soldNow = await prisma.stockItem.count({
      where: { planId: fixture.plan.id, status: StockStatus.SOLD }
    })
    expect(soldNow).toBe(1)

    const boundToOrder = await prisma.stockItem.count({ where: { orderId: order.id } })
    expect(boundToOrder).toBe(1)

    // And it costs nothing the second time around.
    expect(balanceAfterSecondDeliver).toBe(balanceAfterPurchase)
  })
})
