import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { OrderStatus, PaymentProvider, StockStatus, type Order } from '@tgshop/db'
import {
  StockUnavailableError,
  createOrder,
  decrypt,
  deliver,
  type DeliveryResult
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
// The load-bearing test of the suite.
//
// deliver() claims a stock item with `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1`
// inside a transaction. The claim is the only thing standing between the shop
// and selling one ChatGPT login to two customers, and it is exactly the kind
// of guarantee unit tests with a mocked Prisma cannot prove — a mock will
// happily "lock" nothing at all.
//
// So: N real concurrent deliveries against a pool of exactly N items. The pass
// condition is N distinct credentials, N distinct items, zero left over. A
// findFirst+update implementation fails here by handing the same row to two
// transactions: two orders would carry the same payload and one item would stay
// AVAILABLE. Then the (N+1)th delivery must be told the pool is empty rather
// than inventing an item.
// ─────────────────────────────────────────────────────────────────────────────

const CONCURRENCY = 8
const PRICE_CENTS = 100

describe('concurrent delivery against a finite stock pool', () => {
  let fixture: TestFixture
  let orders: Order[]
  let extraOrder: Order
  let results: PromiseSettledResult<DeliveryResult>[]

  beforeAll(async () => {
    fixture = await createFixture({ priceCents: PRICE_CENTS, stockCount: CONCURRENCY })
    await topUp(fixture.user.id, PRICE_CENTS * (CONCURRENCY + 1), fixture.key('topup'))

    // Orders are created and paid sequentially: the race under test is the
    // stock claim, and serialising the money keeps it the only variable.
    const created: Order[] = []
    for (let i = 0; i <= CONCURRENCY; i++) {
      const order = await prisma.$transaction((tx) =>
        createOrder(tx, {
          userId: fixture.user.id,
          planId: fixture.plan.id,
          qty: 1,
          provider: PaymentProvider.BALANCE,
          idempotencyKey: fixture.key(`order-${i}`)
        })
      )
      await payOrderFromBalance(order)
      created.push(order)
    }

    orders = created.slice(0, CONCURRENCY)
    extraOrder = requireDefined(created[CONCURRENCY], 'the overflow order')

    // The actual race: N deliveries in flight at the same time.
    results = await Promise.allSettled(orders.map((order) => deliver(prisma, order.id)))
  })

  afterAll(async () => {
    await fixture.cleanup()
  })

  it(`settles all ${CONCURRENCY} concurrent deliveries successfully`, () => {
    const rejections = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => String(result.reason))
    expect(rejections).toEqual([])
    expect(results).toHaveLength(CONCURRENCY)
  })

  it('hands out N DISTINCT payloads — never the same credential twice', () => {
    const payloads = results
      .filter((result): result is PromiseFulfilledResult<DeliveryResult> => result.status === 'fulfilled')
      .map((result) => result.value.payload)

    expect(payloads).toHaveLength(CONCURRENCY)
    expect(new Set(payloads).size).toBe(CONCURRENCY)
    // Every credential minted for the plan was handed out, each exactly once.
    expect([...payloads].sort()).toEqual([...fixture.stockPlaintexts].sort())
  })

  it('consumes exactly N stock items, each bound to a different order', async () => {
    const counts = await stockCounts(fixture.plan.id)
    expect(counts[StockStatus.SOLD]).toBe(CONCURRENCY)
    expect(counts[StockStatus.AVAILABLE]).toBe(0)
    expect(counts[StockStatus.RESERVED]).toBe(0)

    const sold = await prisma.stockItem.findMany({
      where: { planId: fixture.plan.id, status: StockStatus.SOLD }
    })
    const boundOrderIds = sold.map((item) => requireDefined(item.orderId, 'sold item orderId'))
    expect(new Set(boundOrderIds).size).toBe(CONCURRENCY)
    expect([...boundOrderIds].sort()).toEqual(orders.map((order) => order.id).sort())
  })

  it('gives every order the credential of the item it was actually bound to', async () => {
    for (const [index, order] of orders.entries()) {
      const result = requireDefined(results[index], `result for order ${index}`)
      expect(result.status).toBe('fulfilled')
      if (result.status !== 'fulfilled') continue

      const item = requireDefined(
        await prisma.stockItem.findFirst({ where: { orderId: order.id } }),
        `stock item bound to order ${order.id}`
      )
      expect(decrypt(item.payloadEnc)).toBe(result.value.payload)

      const stored = requireDefined(
        await prisma.order.findUnique({ where: { id: order.id } }),
        `order ${order.id}`
      )
      expect(stored.status).toBe(OrderStatus.DELIVERED)
      expect(decrypt(requireDefined(stored.deliveredPayloadEnc, 'deliveredPayloadEnc'))).toBe(
        result.value.payload
      )
    }
  })

  it('fails the (N+1)th delivery with StockUnavailableError instead of over-selling', async () => {
    await expect(deliver(prisma, extraOrder.id)).rejects.toBeInstanceOf(StockUnavailableError)

    const counts = await stockCounts(fixture.plan.id)
    expect(counts[StockStatus.SOLD]).toBe(CONCURRENCY)
    expect(counts[StockStatus.AVAILABLE]).toBe(0)

    // No phantom item was created for the loser, and its order is left
    // DELIVERING — retryable on restock, deliberately not FAILED.
    expect(await prisma.stockItem.count({ where: { orderId: extraOrder.id } })).toBe(0)
    const stored = requireDefined(
      await prisma.order.findUnique({ where: { id: extraOrder.id } }),
      'the overflow order'
    )
    expect(stored.status).toBe(OrderStatus.DELIVERING)
    expect(stored.deliveredPayloadEnc).toBeNull()
  })
})
