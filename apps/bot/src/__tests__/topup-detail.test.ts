import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import type { Payment } from '@tgshop/db'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/topups/:id — the balance screen polls this until a top-up settles.
// Dependency-free like the rest of the suite: Prisma is an in-memory map, redis
// and the logger are stubs. The route's own try/catch + sendError turns
// HttpErrors into responses, so a bare Fastify instance is enough.
// ─────────────────────────────────────────────────────────────────────────────

const { store, redisMock, logger } = vi.hoisted(() => {
  const logger: Record<string, unknown> = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }
  logger['child'] = vi.fn(() => logger)
  return {
    store: { payments: new Map<string, unknown>() },
    redisMock: { set: vi.fn(async () => 'OK'), get: vi.fn(async () => null), del: vi.fn(async () => 1) },
    logger
  }
})

vi.mock('../config/redis.js', () => ({ redis: redisMock }))
vi.mock('../lib/logger.js', () => ({ logger }))
vi.mock('@tgshop/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tgshop/db')>()
  return {
    ...actual,
    prisma: {
      payment: {
        findUnique: vi.fn(async (args: { where: { id: string } }) => store.payments.get(args.where.id) ?? null),
        findMany: vi.fn(async () => [])
      }
    }
  }
})

const { PaymentProvider, PaymentStatus } = await import('@tgshop/db')
const { toTopupDetailDto } = await import('../server/routes/api/presenters.js')
const { registerTopupRoutes } = await import('../server/routes/api/topup.js')

const OWNER = 'user_owner'
const STRANGER = 'user_stranger'
const RECEIVE = 'TAbcdefghijkmnopqrstuvwxyz12345678'
const CREATED_AT = new Date('2026-09-02T12:00:00.000Z')
const WINDOW_MS = 20 * 60 * 1000

function payment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'pay_topup_1',
    orderId: null,
    userId: OWNER,
    provider: PaymentProvider.TRON_TRC20,
    providerInvoiceId: null,
    amount: 10_000_042n,
    asset: 'USDT',
    network: 'TRC20',
    address: RECEIVE,
    txHash: null,
    confirmations: 0,
    status: PaymentStatus.PENDING,
    rawPayload: {},
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides
  } as Payment
}

async function buildApp(userId: string | null): Promise<ReturnType<typeof Fastify>> {
  const app = Fastify()
  app.addHook('onRequest', async (req) => {
    if (userId) Object.assign(req, { auth: { userId, tgId: '1' } })
  })
  registerTopupRoutes(app)
  await app.ready()
  return app
}

beforeEach(() => {
  store.payments.clear()
})

describe('toTopupDetailDto', () => {
  it('exposes TRON instructions with the 20-minute window while the invoice is open', () => {
    const dto = toTopupDetailDto(payment())
    expect(dto).toMatchObject({ paymentId: 'pay_topup_1', provider: 'TRON_TRC20', status: 'PENDING', redirectUrl: null })
    expect(dto.tron).toMatchObject({ address: RECEIVE, network: 'TRC20', amountUsdt6: '10000042' })
    expect(dto.tron?.expiresAt).toBe(new Date(CREATED_AT.getTime() + WINDOW_MS).toISOString())
  })

  it('keeps TRON instructions while CONFIRMING', () => {
    expect(toTopupDetailDto(payment({ status: PaymentStatus.CONFIRMING })).tron).not.toBeNull()
  })

  it('returns the provider pay link for redirect providers', () => {
    const dto = toTopupDetailDto(
      payment({ provider: PaymentProvider.CRYPTOBOT, address: null, rawPayload: { payUrl: 'https://t.me/CryptoBot?start=x' } })
    )
    expect(dto.redirectUrl).toBe('https://t.me/CryptoBot?start=x')
    expect(dto.tron).toBeNull()
  })

  it('refuses non-https pay links', () => {
    const dto = toTopupDetailDto(payment({ provider: PaymentProvider.CRYPTOBOT, address: null, rawPayload: { payUrl: 'http://evil' } }))
    expect(dto.redirectUrl).toBeNull()
  })

  it.each([PaymentStatus.PAID, PaymentStatus.EXPIRED, PaymentStatus.FAILED, PaymentStatus.UNDERPAID])(
    'hides payment instructions once the invoice is %s',
    (status) => {
      const dto = toTopupDetailDto(payment({ status, rawPayload: { payUrl: 'https://t.me/CryptoBot?start=x' } }))
      expect(dto.status).toBe(status)
      expect(dto.redirectUrl).toBeNull()
      expect(dto.tron).toBeNull()
    }
  )
})

describe('GET /api/topups/:id', () => {
  it('returns the caller’s own top-up', async () => {
    store.payments.set('pay_topup_1', payment())
    const app = await buildApp(OWNER)
    const res = await app.inject({ method: 'GET', url: '/api/topups/pay_topup_1' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ paymentId: 'pay_topup_1', status: 'PENDING', tron: { amountUsdt6: '10000042' } })
    await app.close()
  })

  it('404s another user’s payment instead of leaking it', async () => {
    store.payments.set('pay_topup_1', payment())
    const app = await buildApp(STRANGER)
    const res = await app.inject({ method: 'GET', url: '/api/topups/pay_topup_1' })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('404s payments that belong to an order (those live under /api/orders/:id)', async () => {
    store.payments.set('pay_topup_1', payment({ orderId: 'order_1' }))
    const app = await buildApp(OWNER)
    const res = await app.inject({ method: 'GET', url: '/api/topups/pay_topup_1' })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('404s unknown ids', async () => {
    const app = await buildApp(OWNER)
    const res = await app.inject({ method: 'GET', url: '/api/topups/nope' })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('401s when the auth hook did not run', async () => {
    store.payments.set('pay_topup_1', payment())
    const app = await buildApp(null)
    const res = await app.inject({ method: 'GET', url: '/api/topups/pay_topup_1' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })
})
