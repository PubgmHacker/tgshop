import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TRON_TAG_MAX, tronTagOfAmountUsdt6, tronTaggedAmountUsdt6 } from '@tgshop/core'

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for the single-address TRON rail: receive-address resolution and
// the global sub-cent tag allocator (one namespace of 99 tags for every price). Dependency-free like the rest of the
// bot suite — @tgshop/db, redis, env and the logger are mocks.
// ─────────────────────────────────────────────────────────────────────────────

// Well-formed T-addresses (format only; the resolver does not checksum).
const RECEIVE = 'TAbcdefghijkmnopqrstuvwxyz12345678'
const LEGACY_SWEEP = 'TZyxwvutsrqponmkjihgfedcba12345678'

interface OpenRow {
  amount: bigint
}

const { mockEnv, store, redisMock, logger } = vi.hoisted(() => ({
  mockEnv: {
    TRON_RECEIVE_ADDRESS: '' as string | undefined,
    TRON_SWEEP_TO_ADDRESS: '' as string | undefined
  },
  store: { open: [] as OpenRow[], lastWhere: null as unknown },
  redisMock: { set: vi.fn(async (): Promise<string | null> => 'OK') },
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

vi.mock('../config/env.js', () => ({ env: mockEnv }))
vi.mock('../config/redis.js', () => ({ redis: redisMock }))
vi.mock('../lib/logger.js', () => ({ logger }))
vi.mock('@tgshop/db', async (importOriginal) => {
  // Real enums (PaymentStatus, OrderStatus, ...) — @tgshop/core reads them at
  // module load — with only the Prisma client replaced by an in-memory store.
  const actual = await importOriginal<typeof import('@tgshop/db')>()
  return {
    ...actual,
    prisma: {
      payment: {
        findMany: vi.fn(async (args: { where: unknown }) => {
          store.lastWhere = args.where
          return store.open
        })
      }
    }
  }
})

const { allocateTronTag, getTronReceiveAddress, TronTagsExhaustedError, TronTagReservationError, TRON_TAG_GRACE_MS } =
  await import('../payments/tron.js')

const WINDOW_MS = 20 * 60 * 1000

beforeEach(() => {
  store.open = []
  store.lastWhere = null
  mockEnv.TRON_RECEIVE_ADDRESS = RECEIVE
  mockEnv.TRON_SWEEP_TO_ADDRESS = LEGACY_SWEEP
  redisMock.set.mockReset()
  redisMock.set.mockImplementation(async () => 'OK')
  logger.warn.mockClear()
  logger.error.mockClear()
})

describe('getTronReceiveAddress', () => {
  it('prefers TRON_RECEIVE_ADDRESS', () => {
    expect(getTronReceiveAddress()).toBe(RECEIVE)
  })

  it('falls back to the legacy TRON_SWEEP_TO_ADDRESS', () => {
    mockEnv.TRON_RECEIVE_ADDRESS = ''
    expect(getTronReceiveAddress()).toBe(LEGACY_SWEEP)
  })

  it('refuses malformed values instead of quoting them to customers', () => {
    mockEnv.TRON_RECEIVE_ADDRESS = 'not-an-address'
    mockEnv.TRON_SWEEP_TO_ADDRESS = '0x00000000000000000000000000000000000000ab'
    expect(getTronReceiveAddress()).toBeNull()
    mockEnv.TRON_SWEEP_TO_ADDRESS = undefined
    expect(getTronReceiveAddress()).toBeNull()
  })

  it('tolerates surrounding whitespace from copy-paste', () => {
    mockEnv.TRON_RECEIVE_ADDRESS = `  ${RECEIVE}\n`
    expect(getTronReceiveAddress()).toBe(RECEIVE)
  })
})

describe('allocateTronTag', () => {
  it('returns a tag inside 1..99 and reserves it in redis for window + grace', async () => {
    const tag = await allocateTronTag(2900, WINDOW_MS)

    expect(tag).toBeGreaterThanOrEqual(1)
    expect(tag).toBeLessThanOrEqual(TRON_TAG_MAX)
    expect(redisMock.set).toHaveBeenCalledTimes(1)
    expect(redisMock.set).toHaveBeenCalledWith(
      `tron:tag:${tag}`,
      '1',
      'PX',
      WINDOW_MS + TRON_TAG_GRACE_MS,
      'NX'
    )
  })

  it('looks at every open TRON invoice regardless of price (tags are global)', async () => {
    await allocateTronTag(2900, WINDOW_MS)

    expect(store.lastWhere).toMatchObject({
      provider: 'TRON_TRC20',
      status: { in: ['PENDING', 'CONFIRMING', 'UNDERPAID'] }
    })
    expect(store.lastWhere).not.toHaveProperty('amount')
  })

  it('treats a tag held by an invoice of a different price as taken', async () => {
    // Tags are matched by the sub-cent remainder alone, so an open $5.00
    // invoice with tag 7 blocks tag 7 for a $29.00 checkout as well.
    store.open = Array.from({ length: TRON_TAG_MAX }, (_, i) => i + 1)
      .filter((tag) => tag !== 7)
      .map((tag) => ({ amount: tronTaggedAmountUsdt6(tag % 2 ? 500 : 2900, tag) }))

    const tag = await allocateTronTag(2900, WINDOW_MS)

    expect(tag).toBe(7)
  })

  it('never hands out a tag an open invoice already holds', async () => {
    // 98 of 99 tags are busy; only tag 42 is free.
    store.open = Array.from({ length: TRON_TAG_MAX }, (_, i) => i + 1)
      .filter((tag) => tag !== 42)
      .map((tag) => ({ amount: tronTaggedAmountUsdt6(2900, tag) }))

    const tag = await allocateTronTag(2900, WINDOW_MS)

    expect(tag).toBe(42)
    expect(tronTagOfAmountUsdt6(tronTaggedAmountUsdt6(2900, tag))).toBe(42)
  })

  it('fails loudly when every tag is in use', async () => {
    store.open = Array.from({ length: TRON_TAG_MAX }, (_, i) => ({
      amount: tronTaggedAmountUsdt6(2900, i + 1)
    }))

    await expect(allocateTronTag(2900, WINDOW_MS)).rejects.toBeInstanceOf(TronTagsExhaustedError)
    expect(redisMock.set).not.toHaveBeenCalled()
  })

  it('moves on when redis reports the tag was reserved by a concurrent checkout', async () => {
    redisMock.set.mockImplementationOnce(async () => null)

    const tag = await allocateTronTag(500, WINDOW_MS)

    expect(redisMock.set).toHaveBeenCalledTimes(2)
    const [firstKey] = redisMock.set.mock.calls[0] as unknown as [string]
    const [secondKey] = redisMock.set.mock.calls[1] as unknown as [string]
    expect(firstKey).not.toBe(secondKey)
    expect(secondKey).toBe(`tron:tag:${tag}`)
  })

  it('fails closed when redis is down instead of risking a duplicate tag', async () => {
    redisMock.set.mockImplementation(async () => {
      throw new Error('ECONNREFUSED')
    })

    await expect(allocateTronTag(500, WINDOW_MS)).rejects.toBeInstanceOf(TronTagReservationError)
    expect(redisMock.set).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledTimes(1)
  })

  it('rejects a non-positive amount', async () => {
    await expect(allocateTronTag(0, WINDOW_MS)).rejects.toThrow(RangeError)
    await expect(allocateTronTag(12.5, WINDOW_MS)).rejects.toThrow(RangeError)
  })
})
