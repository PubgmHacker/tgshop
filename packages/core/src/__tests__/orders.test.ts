import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LedgerType, OrderStatus, PaymentProvider } from '@tgshop/db'
import type { PrismaTx } from '../ledger.js'
import {
  ALLOWED_TRANSITIONS,
  assertTransition,
  createOrder,
  expireOrder,
  markDelivered,
  markDelivering,
  markFailed,
  markPaid,
  refundOrder
} from '../orders.js'
import { OrderStateError, PromoInvalidError, StockUnavailableError } from '../errors.js'

// ─────────────────────────────────────────────────────────────────────────────
// A hand-rolled in-memory stand-in for Prisma.TransactionClient. Only the model
// methods orders.ts actually touches are implemented; everything else would be a
// loud runtime error rather than a silent wrong answer.
// ─────────────────────────────────────────────────────────────────────────────

interface FakeOrderRow {
  id: string
  userId: string
  planId: string
  qty: number
  amountCents: number
  status: OrderStatus
  paidAt: Date | null
  externalId: string | null
  deliveredPayloadEnc: string | null
  deliveredAt: Date | null
  promoId: string | null
  idempotencyKey: string
}

function makeOrderRow(overrides: Partial<FakeOrderRow> = {}): FakeOrderRow {
  return {
    id: 'order_1',
    userId: 'user_1',
    planId: 'plan_1',
    qty: 1,
    amountCents: 1299,
    status: OrderStatus.PENDING,
    paidAt: null,
    externalId: null,
    deliveredPayloadEnc: null,
    deliveredAt: null,
    promoId: null,
    idempotencyKey: 'idem_1',
    ...overrides
  }
}

function makeTx(rows: FakeOrderRow[] = []) {
  const orders = new Map(rows.map((row) => [row.id, { ...row }]))
  const ledgerRows: Array<{ userId: string; amountCents: number; type: LedgerType }> = []
  const idempotency = new Map<string, { scope: string; resultJson: unknown }>()

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
    sortOrder: 0
  }

  const api = {
    order: {
      findUnique: vi.fn(async (args: { where: { id?: string; idempotencyKey?: string } }) => {
        if (args.where.id !== undefined) {
          const found = orders.get(args.where.id)
          return found ? { ...found } : null
        }
        for (const row of orders.values()) {
          if (row.idempotencyKey === args.where.idempotencyKey) return { ...row }
        }
        return null
      }),
      update: vi.fn(async (args: { where: { id: string }; data: Partial<FakeOrderRow> }) => {
        const row = orders.get(args.where.id)
        if (!row) throw new Error(`fake tx: no order ${args.where.id}`)
        Object.assign(row, args.data)
        return { ...row }
      }),
      create: vi.fn(async (args: { data: Partial<FakeOrderRow> }) => {
        const row = makeOrderRow({ id: `order_${orders.size + 1}`, ...args.data })
        orders.set(row.id, row)
        return { ...row }
      }),
      count: vi.fn(async () => 0)
    },
    plan: {
      findUnique: vi.fn(async (): Promise<typeof plan | null> => ({ ...plan }))
    },
    promo: {
      findUnique: vi.fn(async (args: { where: { code: string } }) =>
        args.where.code === 'SAVE10'
          ? {
              id: 'promo_1',
              code: 'SAVE10',
              type: 'PERCENT',
              value: 10,
              maxUses: null,
              usedCount: 0,
              expiresAt: null,
              planId: null,
              isActive: true
            }
          : null
      )
    },
    stockItem: {
      updateMany: vi.fn(async () => ({ count: 0 }))
    },
    auditLog: {
      create: vi.fn(async () => ({ id: 'audit_1' }))
    },
    balanceTransaction: {
      aggregate: vi.fn(async () => ({
        _sum: { amountCents: ledgerRows.reduce((sum, row) => sum + row.amountCents, 0) }
      })),
      create: vi.fn(async (args: { data: { userId: string; amountCents: number; type: LedgerType } }) => {
        ledgerRows.push(args.data)
        return { id: `bt_${ledgerRows.length}`, ...args.data }
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
    $executeRaw: vi.fn(async () => 1)
  }

  return { tx: api as unknown as PrismaTx, api, orders, ledgerRows }
}

describe('ALLOWED_TRANSITIONS', () => {
  it('has an entry for every OrderStatus', () => {
    for (const status of Object.values(OrderStatus)) {
      expect(ALLOWED_TRANSITIONS[status]).toBeDefined()
    }
  })

  it('makes EXPIRED and REFUNDED terminal', () => {
    expect(ALLOWED_TRANSITIONS[OrderStatus.EXPIRED]).toHaveLength(0)
    expect(ALLOWED_TRANSITIONS[OrderStatus.REFUNDED]).toHaveLength(0)
  })

  it('matches the documented graph exactly', () => {
    expect([...ALLOWED_TRANSITIONS[OrderStatus.PENDING]].sort()).toEqual(
      [OrderStatus.EXPIRED, OrderStatus.FAILED, OrderStatus.PAID].sort()
    )
    expect([...ALLOWED_TRANSITIONS[OrderStatus.PAID]].sort()).toEqual(
      [OrderStatus.DELIVERING, OrderStatus.FAILED, OrderStatus.REFUNDED].sort()
    )
    expect([...ALLOWED_TRANSITIONS[OrderStatus.DELIVERING]].sort()).toEqual(
      [OrderStatus.DELIVERED, OrderStatus.FAILED].sort()
    )
    expect([...ALLOWED_TRANSITIONS[OrderStatus.DELIVERED]]).toEqual([OrderStatus.REFUNDED])
    expect([...ALLOWED_TRANSITIONS[OrderStatus.FAILED]]).toEqual([OrderStatus.REFUNDED])
  })
})

describe('assertTransition', () => {
  it('passes for every legal edge', () => {
    for (const [from, targets] of Object.entries(ALLOWED_TRANSITIONS)) {
      for (const to of targets) {
        expect(() => assertTransition(from as OrderStatus, to)).not.toThrow()
      }
    }
  })

  it('throws OrderStateError for every edge outside the graph', () => {
    const all = Object.values(OrderStatus)
    for (const from of all) {
      for (const to of all) {
        if (ALLOWED_TRANSITIONS[from].includes(to)) continue
        expect(() => assertTransition(from, to), `${from} -> ${to}`).toThrow(OrderStateError)
      }
    }
  })

  it('reports both ends of the illegal transition on the error', () => {
    try {
      assertTransition(OrderStatus.EXPIRED, OrderStatus.PAID)
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(OrderStateError)
      const stateError = err as OrderStateError
      expect(stateError.from).toBe(OrderStatus.EXPIRED)
      expect(stateError.to).toBe(OrderStatus.PAID)
      expect(stateError.code).toBe('ORDER_STATE_ERROR')
    }
  })
})

// Every mutator, keyed by the status it moves an order into.
const MUTATORS: Record<
  Exclude<OrderStatus, 'PENDING'>,
  (tx: PrismaTx, orderId: string) => Promise<{ status: OrderStatus }>
> = {
  [OrderStatus.PAID]: (tx, id) => markPaid(tx, id),
  [OrderStatus.DELIVERING]: (tx, id) => markDelivering(tx, id),
  [OrderStatus.DELIVERED]: (tx, id) => markDelivered(tx, id, 'v1:enc'),
  [OrderStatus.FAILED]: (tx, id) => markFailed(tx, id, 'test reason'),
  [OrderStatus.EXPIRED]: (tx, id) => expireOrder(tx, id),
  [OrderStatus.REFUNDED]: (tx, id) => refundOrder(tx, id, 'test reason')
}

describe('order mutators against the state machine', () => {
  it('performs every legal transition', async () => {
    for (const [from, targets] of Object.entries(ALLOWED_TRANSITIONS)) {
      for (const to of targets) {
        const { tx } = makeTx([makeOrderRow({ status: from as OrderStatus })])
        const mutate = MUTATORS[to as Exclude<OrderStatus, 'PENDING'>]
        const updated = await mutate(tx, 'order_1')
        expect(updated.status, `${from} -> ${to}`).toBe(to)
      }
    }
  })

  it.each([
    ['PENDING -> DELIVERED', OrderStatus.PENDING, OrderStatus.DELIVERED],
    ['PENDING -> REFUNDED', OrderStatus.PENDING, OrderStatus.REFUNDED],
    ['DELIVERED -> DELIVERING', OrderStatus.DELIVERED, OrderStatus.DELIVERING],
    ['DELIVERED -> FAILED', OrderStatus.DELIVERED, OrderStatus.FAILED],
    ['FAILED -> PAID', OrderStatus.FAILED, OrderStatus.PAID],
    ['EXPIRED -> PAID', OrderStatus.EXPIRED, OrderStatus.PAID],
    ['EXPIRED -> REFUNDED', OrderStatus.EXPIRED, OrderStatus.REFUNDED],
    ['REFUNDED -> REFUNDED', OrderStatus.REFUNDED, OrderStatus.REFUNDED],
    ['REFUNDED -> DELIVERING', OrderStatus.REFUNDED, OrderStatus.DELIVERING]
  ])('rejects %s with OrderStateError', async (_label, from, to) => {
    const { tx } = makeTx([makeOrderRow({ status: from as OrderStatus })])
    const mutate = MUTATORS[to as Exclude<OrderStatus, 'PENDING'>]
    await expect(mutate(tx, 'order_1')).rejects.toThrow(OrderStateError)
  })
})

describe('markPaid', () => {
  it('moves PENDING to PAID and stamps paidAt', async () => {
    const { tx, api } = makeTx([makeOrderRow()])
    const order = await markPaid(tx, 'order_1', { externalId: 'inv_42' })

    expect(order.status).toBe(OrderStatus.PAID)
    expect(order.paidAt).toBeInstanceOf(Date)
    expect(order.externalId).toBe('inv_42')
    expect(api.order.update).toHaveBeenCalledTimes(1)
  })

  it.each([OrderStatus.PAID, OrderStatus.DELIVERING, OrderStatus.DELIVERED])(
    'is idempotent from %s: returns the row untouched',
    async (status) => {
      const paidAt = new Date('2026-01-01T00:00:00Z')
      const { tx, api } = makeTx([makeOrderRow({ status, paidAt, externalId: 'inv_original' })])

      const order = await markPaid(tx, 'order_1', { externalId: 'inv_duplicate' })

      expect(order.status).toBe(status)
      expect(order.paidAt).toEqual(paidAt)
      expect(order.externalId).toBe('inv_original')
      expect(api.order.update).not.toHaveBeenCalled()
    }
  )

  it('does not re-credit or re-stamp on a duplicate webhook', async () => {
    const { tx, api } = makeTx([makeOrderRow()])
    const first = await markPaid(tx, 'order_1')
    const second = await markPaid(tx, 'order_1')

    expect(second.paidAt).toEqual(first.paidAt)
    expect(api.order.update).toHaveBeenCalledTimes(1)
  })
})

describe('markDelivering', () => {
  it('is retry-safe when the order is already DELIVERING', async () => {
    const { tx, api } = makeTx([makeOrderRow({ status: OrderStatus.DELIVERING })])
    const order = await markDelivering(tx, 'order_1')

    expect(order.status).toBe(OrderStatus.DELIVERING)
    expect(api.order.update).not.toHaveBeenCalled()
  })
})

describe('expireOrder', () => {
  it('releases stock reserved for the order', async () => {
    const { tx, api } = makeTx([makeOrderRow()])
    await expireOrder(tx, 'order_1')

    expect(api.stockItem.updateMany).toHaveBeenCalledWith({
      where: { orderId: 'order_1', status: 'RESERVED' },
      data: { status: 'AVAILABLE', orderId: null, reservedUntil: null }
    })
  })
})

describe('refundOrder', () => {
  it('credits the ledger back and marks the order REFUNDED', async () => {
    const { tx, ledgerRows } = makeTx([makeOrderRow({ status: OrderStatus.DELIVERED })])
    const order = await refundOrder(tx, 'order_1', 'customer asked')

    expect(order.status).toBe(OrderStatus.REFUNDED)
    expect(ledgerRows).toHaveLength(1)
    expect(ledgerRows[0]).toMatchObject({
      userId: 'user_1',
      amountCents: 1299,
      type: LedgerType.REFUND
    })
  })

  it('skips the ledger for a zero-amount order', async () => {
    const { tx, ledgerRows } = makeTx([
      makeOrderRow({ status: OrderStatus.FAILED, amountCents: 0 })
    ])
    const order = await refundOrder(tx, 'order_1', 'free order')

    expect(order.status).toBe(OrderStatus.REFUNDED)
    expect(ledgerRows).toHaveLength(0)
  })
})

describe('createOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a PENDING order priced from the plan', async () => {
    const { tx, api } = makeTx()
    const order = await createOrder(tx, {
      userId: 'user_1',
      planId: 'plan_1',
      qty: 2,
      provider: PaymentProvider.BALANCE,
      idempotencyKey: 'idem_new'
    })

    expect(order.status).toBe(OrderStatus.PENDING)
    expect(order.amountCents).toBe(2598)
    expect(api.order.create).toHaveBeenCalledTimes(1)
  })

  it('is idempotent on idempotencyKey: a repeat returns the same order', async () => {
    const { tx, api } = makeTx()
    const input = {
      userId: 'user_1',
      planId: 'plan_1',
      qty: 1,
      provider: PaymentProvider.CRYPTOBOT,
      idempotencyKey: 'idem_repeat'
    }

    const first = await createOrder(tx, input)
    const second = await createOrder(tx, input)

    expect(second.id).toBe(first.id)
    expect(api.order.create).toHaveBeenCalledTimes(1)
  })

  it('applies a promo by code', async () => {
    const { tx } = makeTx()
    const order = await createOrder(tx, {
      userId: 'user_1',
      planId: 'plan_1',
      qty: 1,
      provider: PaymentProvider.BALANCE,
      promoCode: 'SAVE10',
      idempotencyKey: 'idem_promo'
    })

    // 1299 - round(129.9) = 1299 - 130
    expect(order.amountCents).toBe(1169)
    expect(order.promoId).toBe('promo_1')
  })

  it('rejects an unknown promo code', async () => {
    const { tx } = makeTx()
    await expect(
      createOrder(tx, {
        userId: 'user_1',
        planId: 'plan_1',
        qty: 1,
        provider: PaymentProvider.BALANCE,
        promoCode: 'NOPE',
        idempotencyKey: 'idem_bad_promo'
      })
    ).rejects.toThrow(PromoInvalidError)
  })

  it('refuses an inactive plan', async () => {
    const { tx, api } = makeTx()
    api.plan.findUnique.mockResolvedValueOnce(null)

    await expect(
      createOrder(tx, {
        userId: 'user_1',
        planId: 'plan_gone',
        qty: 1,
        provider: PaymentProvider.BALANCE,
        idempotencyKey: 'idem_no_plan'
      })
    ).rejects.toThrow(StockUnavailableError)
  })
})
