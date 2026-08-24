import { describe, it, expect } from 'vitest'
import { OrderStatus, SubStatus } from '@tgshop/db'
import type { PrismaClient } from '@tgshop/db'
import { decrypt, encrypt } from '../crypto.js'
import { deliverManualOrder } from '../manual-delivery.js'
import { OrderNotFoundError, OrderStateError } from '../errors.js'

// A throwaway AES-256 key; crypto.ts reads ENCRYPTION_KEY lazily per call.
process.env.ENCRYPTION_KEY = 'a'.repeat(64)

const DAY_MS = 24 * 60 * 60 * 1000

// ─────────────────────────────────────────────────────────────────────────────
// One fake object plays both PrismaClient and Prisma.TransactionClient, with
// $transaction handing itself to the callback — enough to exercise the real
// status-machine + encrypt + subscription path without a database.
// ─────────────────────────────────────────────────────────────────────────────

interface FakeSubscription {
  id: string
  userId: string
  planId: string
  orderId: string
  startsAt: Date
  expiresAt: Date
  status: SubStatus
}

interface MakeDbOptions {
  orderStatus: OrderStatus
  durationDays?: number | null
  qty?: number
  paidAt?: Date | null
  deliveredPayloadEnc?: string | null
  subscriptions?: FakeSubscription[]
}

function makeDb(opts: MakeDbOptions) {
  const plan = {
    id: 'plan_1',
    productId: 'prod_1',
    title: '1 month',
    durationDays: opts.durationDays === undefined ? 30 : opts.durationDays,
    priceCents: 1299,
    priceStars: 900,
    discountPercent: 0,
    lowStockThreshold: 3,
    isActive: true,
    sortOrder: 0
  }

  const order = {
    id: 'order_1',
    userId: 'user_1',
    planId: 'plan_1',
    qty: opts.qty ?? 1,
    amountCents: 1299,
    currency: 'USD',
    provider: 'BALANCE',
    status: opts.orderStatus,
    externalId: null,
    idempotencyKey: 'idem_1',
    deliveredPayloadEnc: opts.deliveredPayloadEnc ?? null,
    customerEmail: null as string | null,
    promoId: null,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    paidAt: opts.paidAt === undefined ? new Date('2026-08-01T00:05:00Z') : opts.paidAt,
    deliveredAt: null as Date | null,
    expiresAt: null as Date | null
  }

  const subscriptions: FakeSubscription[] = [...(opts.subscriptions ?? [])]
  let subSeq = subscriptions.length

  const db = {
    order: {
      findUnique: async ({ where, include }: { where: { id: string }; include?: { plan?: boolean } }) => {
        if (where.id !== order.id) return null
        return include?.plan ? { ...order, plan } : { ...order }
      },
      update: async ({ data }: { where: { id: string }; data: Record<string, unknown> }) => {
        Object.assign(order, data)
        return { ...order }
      }
    },
    subscription: {
      findUnique: async ({ where }: { where: { orderId: string } }) =>
        subscriptions.find((s) => s.orderId === where.orderId) ?? null,
      findFirst: async ({
        where
      }: {
        where: { userId: string; planId: string; status: SubStatus }
      }) => {
        const matches = subscriptions
          .filter((s) => s.userId === where.userId && s.planId === where.planId && s.status === where.status)
          .sort((a, b) => b.expiresAt.getTime() - a.expiresAt.getTime())
        return matches[0] ?? null
      },
      create: async ({ data }: { data: Omit<FakeSubscription, 'id'> }) => {
        const created: FakeSubscription = { id: `sub_${++subSeq}`, ...data }
        subscriptions.push(created)
        return created
      }
    },
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(db)
  }

  return { db: db as unknown as PrismaClient, order, subscriptions }
}

describe('deliverManualOrder', () => {
  it('delivers a DELIVERING order (the parked MANUAL_FALLBACK case) and creates the subscription', async () => {
    const { db, order, subscriptions } = makeDb({ orderStatus: OrderStatus.DELIVERING })

    const delivered = await deliverManualOrder(db, 'order_1', 'login:x@y.z|password:S3cret')

    expect(delivered.status).toBe(OrderStatus.DELIVERED)
    expect(order.status).toBe(OrderStatus.DELIVERED)
    expect(decrypt(order.deliveredPayloadEnc as unknown as string)).toBe('login:x@y.z|password:S3cret')
    expect(order.deliveredAt).toBeInstanceOf(Date)

    expect(subscriptions).toHaveLength(1)
    const sub = subscriptions[0]!
    expect(sub.orderId).toBe('order_1')
    expect(sub.status).toBe(SubStatus.ACTIVE)
    // startsAt = paidAt, expiresAt = paidAt + durationDays*qty days.
    expect(sub.startsAt.getTime()).toBe(order.paidAt!.getTime())
    expect(sub.expiresAt.getTime()).toBe(order.paidAt!.getTime() + 30 * DAY_MS)
  })

  it('walks a PAID order through the DELIVERING hop first', async () => {
    const { db, order } = makeDb({ orderStatus: OrderStatus.PAID })

    await deliverManualOrder(db, 'order_1', 'CODE-123')

    expect(order.status).toBe(OrderStatus.DELIVERED)
    expect(decrypt(order.deliveredPayloadEnc as unknown as string)).toBe('CODE-123')
  })

  it('multiplies the period by qty', async () => {
    const { db, order, subscriptions } = makeDb({ orderStatus: OrderStatus.DELIVERING, qty: 3 })

    await deliverManualOrder(db, 'order_1', 'CODE')

    expect(subscriptions[0]!.expiresAt.getTime()).toBe(order.paidAt!.getTime() + 90 * DAY_MS)
  })

  it('creates no subscription for a one-off (durationDays null) plan', async () => {
    const { db, order, subscriptions } = makeDb({
      orderStatus: OrderStatus.DELIVERING,
      durationDays: null
    })

    await deliverManualOrder(db, 'order_1', 'CODE')

    expect(order.status).toBe(OrderStatus.DELIVERED)
    expect(subscriptions).toHaveLength(0)
  })

  it('trims the payload before encrypting it', async () => {
    const { db, order } = makeDb({ orderStatus: OrderStatus.DELIVERING })

    await deliverManualOrder(db, 'order_1', '  CODE-42  \n')

    expect(decrypt(order.deliveredPayloadEnc as unknown as string)).toBe('CODE-42')
  })

  it('never overwrites the payload of an already-DELIVERED order', async () => {
    const original = encrypt('the-original-credential')
    const { db, order } = makeDb({
      orderStatus: OrderStatus.DELIVERED,
      deliveredPayloadEnc: original
    })

    const result = await deliverManualOrder(db, 'order_1', 'a-second-different-credential')

    expect(result.status).toBe(OrderStatus.DELIVERED)
    expect(order.deliveredPayloadEnc).toBe(original)
    expect(decrypt(order.deliveredPayloadEnc as unknown as string)).toBe('the-original-credential')
  })

  it('repairs a missing subscription on a repeat call for a DELIVERED order', async () => {
    const { db, subscriptions } = makeDb({
      orderStatus: OrderStatus.DELIVERED,
      deliveredPayloadEnc: encrypt('CODE')
    })
    expect(subscriptions).toHaveLength(0)

    await deliverManualOrder(db, 'order_1', 'ignored — payload is not rewritten')

    expect(subscriptions).toHaveLength(1)
    expect(subscriptions[0]!.orderId).toBe('order_1')
  })

  it('stacks on top of an existing ACTIVE subscription', async () => {
    const paidAt = new Date('2026-08-01T00:05:00Z')
    const currentExpiry = new Date(paidAt.getTime() + 10 * DAY_MS)
    const { db, subscriptions } = makeDb({
      orderStatus: OrderStatus.DELIVERING,
      paidAt,
      subscriptions: [
        {
          id: 'sub_prev',
          userId: 'user_1',
          planId: 'plan_1',
          orderId: 'order_0',
          startsAt: new Date(paidAt.getTime() - 20 * DAY_MS),
          expiresAt: currentExpiry,
          status: SubStatus.ACTIVE
        }
      ]
    })

    await deliverManualOrder(db, 'order_1', 'CODE')

    const created = subscriptions.find((s) => s.orderId === 'order_1')!
    expect(created.expiresAt.getTime()).toBe(currentExpiry.getTime() + 30 * DAY_MS)
  })

  it('rejects an empty or all-whitespace payload without touching the order', async () => {
    const { db, order } = makeDb({ orderStatus: OrderStatus.DELIVERING })

    await expect(deliverManualOrder(db, 'order_1', '   \n\t')).rejects.toThrow(/payload is empty/)

    expect(order.status).toBe(OrderStatus.DELIVERING)
    expect(order.deliveredPayloadEnc).toBeNull()
  })

  it('rejects a PENDING order with OrderStateError', async () => {
    const { db, order } = makeDb({ orderStatus: OrderStatus.PENDING })

    await expect(deliverManualOrder(db, 'order_1', 'CODE')).rejects.toBeInstanceOf(OrderStateError)
    expect(order.status).toBe(OrderStatus.PENDING)
  })

  it('rejects a REFUNDED order with OrderStateError', async () => {
    const { db } = makeDb({ orderStatus: OrderStatus.REFUNDED })

    await expect(deliverManualOrder(db, 'order_1', 'CODE')).rejects.toBeInstanceOf(OrderStateError)
  })

  it('throws OrderNotFoundError for a missing order', async () => {
    const { db } = makeDb({ orderStatus: OrderStatus.PAID })

    await expect(deliverManualOrder(db, 'nope', 'CODE')).rejects.toBeInstanceOf(OrderNotFoundError)
  })
})

describe('readRequiresEmail', () => {
  it('is true only for a strict boolean true', async () => {
    const { readRequiresEmail } = await import('../delivery.js')
    expect(readRequiresEmail({ requiresEmail: true })).toBe(true)
    expect(readRequiresEmail({ requiresEmail: 'true' })).toBe(false)
    expect(readRequiresEmail({ requiresEmail: 1 })).toBe(false)
    expect(readRequiresEmail({})).toBe(false)
    expect(readRequiresEmail(null)).toBe(false)
    expect(readRequiresEmail(undefined)).toBe(false)
    expect(readRequiresEmail([{ requiresEmail: true }])).toBe(false)
    expect(readRequiresEmail('requiresEmail')).toBe(false)
  })
})
