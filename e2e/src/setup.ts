import { randomBytes } from 'node:crypto'
import {
  DeliveryType,
  LedgerType,
  PrismaClient,
  StockStatus,
  type Category,
  type Order,
  type Plan,
  type Prisma,
  type Product,
  type Promo,
  type PromoType,
  type StockItem,
  type User
} from '@tgshop/db'
import { credit, debit, encrypt, markPaid } from '@tgshop/core'

// ─────────────────────────────────────────────────────────────────────────────
// Shared harness for the end-to-end suite.
//
// These tests run against the SAME database the app and the seed use, so the
// golden rule here is: never truncate, never delete anything the fixture did
// not create. Each fixture owns a private Category → Product → Plan → StockItem
// chain plus its own User, all tagged with a per-fixture random id, and tears
// down exactly those rows. The 3 seeded categories / 7 products / 13 plans
// must still be there when the suite finishes, and the suite
// must be runnable twice in a row with no manual reset in between.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A dedicated client rather than @tgshop/db's dev singleton.
 *
 * The connection limit is pinned explicitly because the stock-concurrency test
 * fires N interactive transactions at once: with fewer pool connections than
 * concurrent transactions, Prisma would queue them and the losers would die on
 * the 2s pool timeout — a pool artefact that has nothing to do with the
 * SKIP LOCKED behaviour under test.
 */
function testDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL
  if (!raw) throw new Error('@tgshop/e2e: DATABASE_URL is not set')
  const url = new URL(raw)
  url.searchParams.set('connection_limit', '15')
  url.searchParams.set('pool_timeout', '20')
  return url.toString()
}

export const prisma = new PrismaClient({
  datasourceUrl: testDatabaseUrl(),
  log: ['error']
})

export async function connect(): Promise<void> {
  await prisma.$connect()
}

export async function disconnect(): Promise<void> {
  await prisma.$disconnect()
}

// ── Fixture ──────────────────────────────────────────────────────────────────

export interface FixtureOptions {
  /** Unit price of the fixture plan, in integer cents. */
  priceCents?: number
  /** Plan-level discount, applied before any promo. */
  discountPercent?: number
  /** How the fixture product is delivered. Defaults to STOCK_POOL. */
  deliveryType?: DeliveryType
  /** How many AVAILABLE StockItems to mint for the plan. */
  stockCount?: number
  /** Product.externalConfig, e.g. a `{ codeTemplate }` for UNIQUE_CODE. */
  externalConfig?: Prisma.InputJsonValue
}

export interface PromoOptions {
  type: PromoType
  value: number
  maxUses?: number | null
  expiresAt?: Date | null
  isActive?: boolean
  /** Restrict the promo to the fixture's own plan. Defaults to true. */
  planScoped?: boolean
}

export interface TestFixture {
  /** Random per-run id; every row this fixture creates carries it. */
  readonly id: string
  readonly user: User
  readonly category: Category
  readonly product: Product
  readonly plan: Plan
  readonly stockItems: readonly StockItem[]
  /** Plaintexts encrypted into `stockItems`, in the same order. */
  readonly stockPlaintexts: readonly string[]
  /** Namespaced idempotency key, so two runs never collide on one key. */
  key(suffix: string): string
  createPromo(options: PromoOptions): Promise<Promo>
  cleanup(): Promise<void>
}

function newFixtureId(): string {
  return `${Date.now().toString(36)}${randomBytes(4).toString('hex')}`
}

/**
 * Telegram ids are BigInt and unique. Time-ordered plus a random tail keeps
 * them unique across back-to-back runs and far away from anything a human or
 * the seed would ever pick.
 */
function newTgId(): bigint {
  return BigInt(Date.now()) * 1000n + BigInt(randomBytes(2).readUInt16BE(0) % 1000)
}

/**
 * Creates an isolated Category → Product → Plan → StockItems chain plus a User.
 * Nothing here touches seeded rows.
 */
export async function createFixture(options: FixtureOptions = {}): Promise<TestFixture> {
  const id = newFixtureId()
  const prefix = `e2e-${id}`
  const priceCents = options.priceCents ?? 1999
  const discountPercent = options.discountPercent ?? 0
  const deliveryType = options.deliveryType ?? DeliveryType.STOCK_POOL
  const stockCount = options.stockCount ?? 3

  const user = await prisma.user.create({
    data: {
      tgId: newTgId(),
      username: `${prefix}-user`,
      firstName: 'E2E',
      languageCode: 'en'
    }
  })

  const category = await prisma.category.create({
    data: { title: `E2E ${id}`, slug: `${prefix}-category`, emoji: '🧪', sortOrder: 9000, isActive: true }
  })

  const product = await prisma.product.create({
    data: {
      categoryId: category.id,
      title: `E2E Product ${id}`,
      slug: `${prefix}-product`,
      description: 'Fixture product created by the @tgshop/e2e suite.',
      deliveryType,
      isActive: true,
      sortOrder: 0,
      ...(options.externalConfig === undefined ? {} : { externalConfig: options.externalConfig })
    }
  })

  const plan = await prisma.plan.create({
    data: {
      productId: product.id,
      title: `E2E Plan ${id}`,
      durationDays: 30,
      priceCents,
      discountPercent,
      lowStockThreshold: 1,
      isActive: true,
      sortOrder: 0
    }
  })

  // Created one at a time so every row gets a distinct createdAt: the claim
  // query orders by createdAt, and distinct values make "which item did we get"
  // reproducible instead of tie-broken by the planner.
  const stockPlaintexts: string[] = []
  const stockItems: StockItem[] = []
  for (let i = 0; i < stockCount; i++) {
    const plaintext = `${prefix}-cred-${i}:${randomBytes(6).toString('hex')}`
    stockPlaintexts.push(plaintext)
    stockItems.push(
      await prisma.stockItem.create({
        data: { planId: plan.id, payloadEnc: encrypt(plaintext), status: StockStatus.AVAILABLE }
      })
    )
  }

  const fixture: TestFixture = {
    id,
    user,
    category,
    product,
    plan,
    stockItems,
    stockPlaintexts,

    key(suffix: string): string {
      return `${prefix}:${suffix}`
    },

    async createPromo(promoOptions: PromoOptions): Promise<Promo> {
      return prisma.promo.create({
        data: {
          code: `${prefix}-promo-${randomBytes(3).toString('hex')}`.toUpperCase(),
          type: promoOptions.type,
          value: promoOptions.value,
          maxUses: promoOptions.maxUses ?? null,
          expiresAt: promoOptions.expiresAt ?? null,
          planId: (promoOptions.planScoped ?? true) ? plan.id : null,
          isActive: promoOptions.isActive ?? true
        }
      })
    },

    async cleanup(): Promise<void> {
      // Order matters: children before parents, because every FK here is
      // enforced by Postgres and none of them cascade.
      const orders = await prisma.order.findMany({ where: { userId: user.id }, select: { id: true } })
      const orderIds = orders.map((order) => order.id)

      await prisma.stockItem.deleteMany({
        where: { OR: [{ planId: plan.id }, { orderId: { in: orderIds } }] }
      })
      await prisma.balanceTransaction.deleteMany({ where: { userId: user.id } })
      await prisma.subscription.deleteMany({ where: { userId: user.id } })
      await prisma.payment.deleteMany({ where: { userId: user.id } })

      if (orderIds.length > 0) {
        await prisma.auditLog.deleteMany({ where: { entityId: { in: orderIds } } })
      }

      // Ledger idempotency records are keyed by arbitrary strings (core writes
      // `refund:<orderId>` on its own), so match on the fixture prefix OR on the
      // userId stored inside the recorded result.
      await prisma.idempotencyRecord.deleteMany({
        where: {
          OR: [{ key: { startsWith: prefix } }, { resultJson: { path: ['userId'], equals: user.id } }]
        }
      })

      await prisma.order.deleteMany({ where: { userId: user.id } })
      await prisma.promo.deleteMany({ where: { OR: [{ planId: plan.id }, { code: { startsWith: prefix.toUpperCase() } }] } })
      await prisma.plan.deleteMany({ where: { id: plan.id } })
      await prisma.product.deleteMany({ where: { id: product.id } })
      await prisma.category.deleteMany({ where: { id: category.id } })
      await prisma.user.deleteMany({ where: { id: user.id } })
    }
  }

  return fixture
}

// ── Money helpers ────────────────────────────────────────────────────────────

/** Tops a user up through the real ledger (inside a transaction, as core requires). */
export async function topUp(userId: string, amountCents: number, idempotencyKey: string): Promise<number> {
  const result = await prisma.$transaction((tx) =>
    credit(tx, {
      userId,
      amountCents,
      type: LedgerType.TOPUP,
      idempotencyKey,
      comment: 'e2e top-up'
    })
  )
  return result.balanceAfterCents
}

/**
 * Settles an order out of the user's balance.
 *
 * Mirrors the production BALANCE path (apps/bot payOrderFromBalance): the debit
 * and the status flip share ONE transaction, so a crash can never leave money
 * taken without an order marked PAID. Unlike the bot it goes through core's
 * markPaid rather than a raw update, which keeps the state machine in the loop.
 */
export async function payOrderFromBalance(order: Order): Promise<Order> {
  return prisma.$transaction(async (tx) => {
    await debit(tx, {
      userId: order.userId,
      amountCents: order.amountCents,
      type: LedgerType.PURCHASE,
      orderId: order.id,
      idempotencyKey: `purchase:${order.id}`,
      comment: `e2e purchase ${order.id}`
    })
    return markPaid(tx, order.id)
  })
}

// ── Assertion helpers ────────────────────────────────────────────────────────

/** Narrowing helper: `noUncheckedIndexedAccess` makes every index access optional. */
export function requireDefined<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) {
    throw new Error(`expected ${what} to be defined`)
  }
  return value
}

export async function stockCounts(planId: string): Promise<Record<StockStatus, number>> {
  const rows = await prisma.stockItem.groupBy({
    by: ['status'],
    where: { planId },
    _count: { _all: true }
  })
  const counts: Record<StockStatus, number> = {
    [StockStatus.AVAILABLE]: 0,
    [StockStatus.RESERVED]: 0,
    [StockStatus.SOLD]: 0
  }
  for (const row of rows) counts[row.status] = row._count?._all ?? 0
  return counts
}
