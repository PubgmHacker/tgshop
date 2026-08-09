import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DeliveryType, LedgerType, OrderStatus, StockStatus } from '@tgshop/db'
import type { PrismaClient } from '@tgshop/db'
import { decrypt, encrypt } from '../crypto.js'
import { deliver, resetCircuitBreaker, type ExternalSupplier } from '../delivery.js'
import {
  DeliveryFailedError,
  ManualFallbackRequiredError,
  OrderStateError,
  StockUnavailableError
} from '../errors.js'

// A throwaway AES-256 key; crypto.ts reads ENCRYPTION_KEY lazily per call.
process.env.ENCRYPTION_KEY = 'a'.repeat(64)

// ─────────────────────────────────────────────────────────────────────────────
// One fake object plays both PrismaClient and Prisma.TransactionClient, with
// $transaction handing itself to the callback — enough to exercise the real
// claim/decrypt/re-encrypt path without a database.
// ─────────────────────────────────────────────────────────────────────────────

interface FakeStockItem {
  id: string
  planId: string
  payloadEnc: string
  status: StockStatus
  orderId: string | null
  reservedUntil: Date | null
  createdAt: Date
}

interface FakeLedgerRow {
  userId: string
  amountCents: number
  type: LedgerType
  orderId?: string
}

interface MakeDbOptions {
  deliveryType: DeliveryType
  externalConfig?: unknown
  stock?: FakeStockItem[]
  orderStatus?: OrderStatus
  amountCents?: number
}

function stockItem(overrides: Partial<FakeStockItem> = {}): FakeStockItem {
  return {
    id: 'stock_1',
    planId: 'plan_1',
    payloadEnc: encrypt('login:buyer@example.com|password:Hunter2'),
    status: StockStatus.AVAILABLE,
    orderId: null,
    reservedUntil: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides
  }
}

function makeDb(opts: MakeDbOptions) {
  const product = {
    id: 'prod_1',
    categoryId: 'cat_1',
    title: 'Test product',
    slug: 'test-product',
    description: 'x',
    imageUrl: null,
    deliveryType: opts.deliveryType,
    externalConfig: opts.externalConfig ?? null,
    isActive: true,
    sortOrder: 0
  }

  const plan = {
    id: 'plan_1',
    productId: 'prod_1',
    title: '1 month',
    durationDays: 30,
    priceCents: 1299,
    priceStars: 900,
    discountPercent: 0,
    lowStockThreshold: 3,
    isActive: true,
    sortOrder: 0,
    product
  }

  const order = {
    id: 'order_1',
    userId: 'user_1',
    planId: 'plan_1',
    qty: 1,
    amountCents: opts.amountCents ?? 1299,
    currency: 'USD',
    provider: 'BALANCE',
    status: opts.orderStatus ?? OrderStatus.PAID,
    externalId: null as string | null,
    idempotencyKey: 'idem_1',
    deliveredPayloadEnc: null as string | null,
    promoId: null,
    createdAt: new Date(),
    paidAt: new Date(),
    deliveredAt: null as Date | null,
    expiresAt: null as Date | null
  }

  const stock: FakeStockItem[] = opts.stock ?? []
  const ledger: FakeLedgerRow[] = []
  const idempotency = new Map<string, { scope: string; resultJson: unknown }>()

  const api = {
    order: {
      findUnique: vi.fn(async () => ({ ...order, plan })),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => {
        Object.assign(order, args.data)
        return { ...order, plan }
      })
    },
    stockItem: {
      findFirst: vi.fn(
        async (args: { where: { orderId?: string; status?: { in?: StockStatus[] } } }) => {
          const wanted = args.where.status?.in ?? []
          const found = stock.find(
            (item) => item.orderId === args.where.orderId && wanted.includes(item.status)
          )
          return found ? { ...found } : null
        }
      ),
      update: vi.fn(
        async (args: { where: { id: string }; data: Partial<FakeStockItem> }) => {
          const item = stock.find((row) => row.id === args.where.id)
          if (!item) throw new Error(`fake db: no stock item ${args.where.id}`)
          Object.assign(item, args.data)
          return { ...item }
        }
      ),
      updateMany: vi.fn(async () => ({ count: 0 }))
    },
    auditLog: {
      create: vi.fn(async () => ({ id: 'audit_1' }))
    },
    balanceTransaction: {
      aggregate: vi.fn(async () => ({
        _sum: {
          amountCents:
            ledger.length === 0 ? null : ledger.reduce((sum, row) => sum + row.amountCents, 0)
        }
      })),
      create: vi.fn(async (args: { data: FakeLedgerRow }) => {
        ledger.push(args.data)
        return { id: `bt_${ledger.length}`, ...args.data }
      })
    },
    idempotencyRecord: {
      findUnique: vi.fn(async (args: { where: { key: string } }) => {
        const found = idempotency.get(args.where.key)
        return found ? { key: args.where.key, ...found } : null
      }),
      create: vi.fn(async (args: { data: { key: string; scope: string; resultJson: unknown } }) => {
        idempotency.set(args.data.key, { scope: args.data.scope, resultJson: args.data.resultJson })
        return args.data
      })
    },
    $executeRaw: vi.fn(async () => 1),
    // Stands in for `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1`.
    $queryRaw: vi.fn(async () => {
      const available = stock.find((item) => item.status === StockStatus.AVAILABLE)
      return available ? [{ id: available.id }] : []
    })
  }

  const db = Object.assign(api, {
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(api))
  })

  return { db: db as unknown as PrismaClient, api: db, order, stock, ledger }
}

type FulfillInput = Parameters<ExternalSupplier['fulfill']>[0]

const noSleep = async (): Promise<void> => undefined

beforeEach(() => {
  resetCircuitBreaker()
})

describe('deliver: STOCK_POOL', () => {
  it('claims one item, marks it SOLD and returns the decrypted payload', async () => {
    const { db, api, order, stock } = makeDb({
      deliveryType: DeliveryType.STOCK_POOL,
      stock: [stockItem()]
    })

    const result = await deliver(db, 'order_1')

    expect(result.payload).toBe('login:buyer@example.com|password:Hunter2')
    expect(result.instructions).not.toBe('')
    expect(order.status).toBe(OrderStatus.DELIVERED)
    expect(stock[0]?.status).toBe(StockStatus.SOLD)
    expect(stock[0]?.orderId).toBe('order_1')
    expect(api.$queryRaw).toHaveBeenCalledTimes(1)
  })

  it('stores the payload as fresh ciphertext, not a copy of the stock ciphertext', async () => {
    const item = stockItem()
    const { db, order } = makeDb({ deliveryType: DeliveryType.STOCK_POOL, stock: [item] })

    await deliver(db, 'order_1')

    expect(order.deliveredPayloadEnc).toBeTruthy()
    expect(order.deliveredPayloadEnc).not.toBe(item.payloadEnc)
    expect(decrypt(order.deliveredPayloadEnc as string)).toBe(
      'login:buyer@example.com|password:Hunter2'
    )
  })

  it('is idempotent: a second call does NOT consume a second item', async () => {
    const { db, api, stock } = makeDb({
      deliveryType: DeliveryType.STOCK_POOL,
      stock: [stockItem({ id: 'stock_1' }), stockItem({ id: 'stock_2' })]
    })

    const first = await deliver(db, 'order_1')
    const second = await deliver(db, 'order_1')

    expect(second.payload).toBe(first.payload)
    expect(api.$queryRaw).toHaveBeenCalledTimes(1)
    expect(stock.filter((item) => item.status === StockStatus.SOLD)).toHaveLength(1)
    expect(stock[1]?.status).toBe(StockStatus.AVAILABLE)
    expect(stock[1]?.orderId).toBeNull()
  })

  it('reuses an item already reserved for the order instead of claiming a new one', async () => {
    const { db, api, stock } = makeDb({
      deliveryType: DeliveryType.STOCK_POOL,
      stock: [
        stockItem({
          id: 'stock_reserved',
          status: StockStatus.RESERVED,
          orderId: 'order_1',
          payloadEnc: encrypt('reserved-payload')
        }),
        stockItem({ id: 'stock_other' })
      ]
    })

    const result = await deliver(db, 'order_1')

    expect(result.payload).toBe('reserved-payload')
    expect(api.$queryRaw).not.toHaveBeenCalled()
    expect(stock[0]?.status).toBe(StockStatus.SOLD)
    expect(stock[1]?.status).toBe(StockStatus.AVAILABLE)
  })

  it('throws StockUnavailableError on an empty pool', async () => {
    const { db, order } = makeDb({ deliveryType: DeliveryType.STOCK_POOL, stock: [] })

    await expect(deliver(db, 'order_1')).rejects.toThrow(StockUnavailableError)
    // The order stays DELIVERING so a restock + retry can still fulfil it.
    expect(order.status).toBe(OrderStatus.DELIVERING)
  })

  it('refuses to deliver an order that has not been paid', async () => {
    const { db } = makeDb({
      deliveryType: DeliveryType.STOCK_POOL,
      stock: [stockItem()],
      orderStatus: OrderStatus.PENDING
    })

    await expect(deliver(db, 'order_1')).rejects.toThrow(OrderStateError)
  })
})

describe('deliver: UNIQUE_CODE', () => {
  it('renders a code from the template without touching the pool', async () => {
    const { db, api, order } = makeDb({
      deliveryType: DeliveryType.UNIQUE_CODE,
      externalConfig: { codeTemplate: 'STEAM-{RANDOM8}-{ORDER}' }
    })

    const result = await deliver(db, 'order_1')

    expect(result.payload).toMatch(/^STEAM-[A-HJ-NP-Z2-9]{8}-order_1$/)
    expect(api.$queryRaw).not.toHaveBeenCalled()
    expect(order.status).toBe(OrderStatus.DELIVERED)
    expect(decrypt(order.deliveredPayloadEnc as string)).toBe(result.payload)
  })

  it('gives every {RANDOM8} occurrence its own value', async () => {
    const { db } = makeDb({
      deliveryType: DeliveryType.UNIQUE_CODE,
      externalConfig: { codeTemplate: '{RANDOM8}-{RANDOM8}' }
    })

    const result = await deliver(db, 'order_1')
    const [left, right] = result.payload.split('-')

    expect(left).toHaveLength(8)
    expect(right).toHaveLength(8)
    expect(left).not.toBe(right)
  })

  it('expands {NANOID}', async () => {
    const { db } = makeDb({
      deliveryType: DeliveryType.UNIQUE_CODE,
      externalConfig: { codeTemplate: 'KEY-{NANOID}' }
    })

    const result = await deliver(db, 'order_1')
    expect(result.payload.startsWith('KEY-')).toBe(true)
    expect(result.payload.length).toBeGreaterThan('KEY-'.length)
  })

  it('falls back to the stock pool when the product has no template', async () => {
    const { db, api, stock } = makeDb({
      deliveryType: DeliveryType.UNIQUE_CODE,
      externalConfig: null,
      stock: [stockItem({ payloadEnc: encrypt('WIN-11-PRO-KEY') })]
    })

    const result = await deliver(db, 'order_1')

    expect(result.payload).toBe('WIN-11-PRO-KEY')
    expect(api.$queryRaw).toHaveBeenCalledTimes(1)
    expect(stock[0]?.status).toBe(StockStatus.SOLD)
  })
})

describe('deliver: EXTERNAL_API', () => {
  it('delivers the supplier payload on the first attempt', async () => {
    const fulfill = vi.fn(async (_input: FulfillInput) => ({ payload: 'uc-topup-ok' }))
    const supplier: ExternalSupplier = { fulfill }
    const { db, order } = makeDb({ deliveryType: DeliveryType.EXTERNAL_API })

    const result = await deliver(db, 'order_1', { supplier, sleep: noSleep })

    expect(result.payload).toBe('uc-topup-ok')
    expect(fulfill).toHaveBeenCalledTimes(1)
    expect(fulfill).toHaveBeenCalledWith({ orderId: 'order_1', planId: 'plan_1', qty: 1 })
    expect(order.status).toBe(OrderStatus.DELIVERED)
  })

  it('retries and succeeds on the third attempt', async () => {
    let calls = 0
    const supplier: ExternalSupplier = {
      fulfill: vi.fn(async (): Promise<{ payload: string }> => {
        calls += 1
        if (calls < 3) throw new Error('supplier 503')
        return { payload: 'late-but-ok' }
      })
    }
    const { db, order } = makeDb({ deliveryType: DeliveryType.EXTERNAL_API })

    const result = await deliver(db, 'order_1', { supplier, sleep: noSleep })

    expect(calls).toBe(3)
    expect(result.payload).toBe('late-but-ok')
    expect(order.status).toBe(OrderStatus.DELIVERED)
  })

  it('retries 3 times, then fails the order and refunds to balance', async () => {
    const fulfill = vi.fn(async (): Promise<{ payload: string }> => {
      throw new Error('supplier down')
    })
    const supplier: ExternalSupplier = { fulfill }
    const sleep = vi.fn(async (_ms: number): Promise<void> => undefined)
    const { db, order, ledger } = makeDb({ deliveryType: DeliveryType.EXTERNAL_API })

    await expect(deliver(db, 'order_1', { supplier, sleep })).rejects.toThrow(DeliveryFailedError)

    expect(fulfill).toHaveBeenCalledTimes(3)
    // Exponential backoff between attempts only: 3 attempts -> 2 waits.
    expect(sleep.mock.calls.map((call) => call[0])).toEqual([500, 1000])

    expect(order.status).toBe(OrderStatus.FAILED)
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({
      userId: 'user_1',
      amountCents: 1299,
      type: LedgerType.REFUND,
      orderId: 'order_1'
    })
  })

  it('surfaces the failure reason so the caller can alert an admin', async () => {
    const supplier: ExternalSupplier = {
      fulfill: vi.fn(async (): Promise<{ payload: string }> => {
        throw new Error('supplier down')
      })
    }
    const { db } = makeDb({ deliveryType: DeliveryType.EXTERNAL_API })

    await expect(deliver(db, 'order_1', { supplier, sleep: noSleep })).rejects.toThrow(
      /after 3 attempts: supplier down/
    )
  })

  it('fails and refunds when no supplier is wired up', async () => {
    const { db, order, ledger } = makeDb({ deliveryType: DeliveryType.EXTERNAL_API })

    await expect(deliver(db, 'order_1', { sleep: noSleep })).rejects.toThrow(DeliveryFailedError)
    expect(order.status).toBe(OrderStatus.FAILED)
    expect(ledger).toHaveLength(1)
  })

  it('times out a hanging supplier instead of blocking forever', async () => {
    const supplier: ExternalSupplier = {
      fulfill: vi.fn(
        () => new Promise<{ payload: string }>(() => undefined) // never settles
      )
    }
    const { db, order } = makeDb({ deliveryType: DeliveryType.EXTERNAL_API })

    await expect(
      deliver(db, 'order_1', { supplier, sleep: noSleep, timeoutMs: 5 })
    ).rejects.toThrow(/timed out/)
    expect(order.status).toBe(OrderStatus.FAILED)
  })

  it('treats an empty supplier payload as a failure', async () => {
    const supplier: ExternalSupplier = {
      fulfill: vi.fn(async (): Promise<{ payload: string }> => ({ payload: '' }))
    }
    const { db, order } = makeDb({ deliveryType: DeliveryType.EXTERNAL_API })

    await expect(deliver(db, 'order_1', { supplier, sleep: noSleep })).rejects.toThrow(
      DeliveryFailedError
    )
    expect(order.status).toBe(OrderStatus.FAILED)
  })

  it('opens the circuit breaker after repeated failures and then fails fast', async () => {
    const fulfill = vi.fn(async (): Promise<{ payload: string }> => {
      throw new Error('supplier down')
    })
    const supplier: ExternalSupplier = { fulfill }

    // 3 failed attempts on the first order; the 5-failure threshold is crossed
    // during the second order, which leaves the breaker open.
    const first = makeDb({ deliveryType: DeliveryType.EXTERNAL_API })
    await expect(deliver(first.db, 'order_1', { supplier, sleep: noSleep })).rejects.toThrow()

    const second = makeDb({ deliveryType: DeliveryType.EXTERNAL_API })
    await expect(deliver(second.db, 'order_1', { supplier, sleep: noSleep })).rejects.toThrow()

    const callsBefore = fulfill.mock.calls.length
    const third = makeDb({ deliveryType: DeliveryType.EXTERNAL_API })
    await expect(deliver(third.db, 'order_1', { supplier, sleep: noSleep })).rejects.toThrow(
      /circuit breaker is open/
    )

    // No further supplier calls once open, and the order is left retryable.
    expect(fulfill.mock.calls.length).toBe(callsBefore)
    expect(third.order.status).toBe(OrderStatus.DELIVERING)
    expect(third.ledger).toHaveLength(0)
  })
})

describe('deliver: MANUAL_FALLBACK', () => {
  it('leaves the order DELIVERING and signals that an admin must act', async () => {
    const { db, order, ledger } = makeDb({ deliveryType: DeliveryType.MANUAL_FALLBACK })

    await expect(deliver(db, 'order_1')).rejects.toThrow(ManualFallbackRequiredError)
    expect(order.status).toBe(OrderStatus.DELIVERING)
    expect(ledger).toHaveLength(0)
  })
})
