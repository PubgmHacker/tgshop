import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// Unit test for allocateDepositAddress(). Dependency-free like the rest of the
// bot suite: @tgshop/db, env and the logger are replaced with mocks, so nothing
// here touches Postgres. deriveAddress() from @tgshop/payments is left REAL —
// its correctness is proven in that package's own tests, and exercising it here
// confirms the bot wires it to a genuine, on-curve TRON address.
// ─────────────────────────────────────────────────────────────────────────────

// A deterministic account-level xpub at m/44'/195'/0' (seed = 32 bytes of 0x07).
const TEST_XPUB =
  'xpub6BsE5ivr8c6rcRoCvE8ptxaCtikM4fsrsbYXo53CyeV5zqQpWHW7Ue54pNQbKo4KQ4KN6TPvhH4qhf9QfzycJt4T5MfD4KzvD5puTvaRfxr'

interface FakeRow {
  userId: string
  orderId: string | null
  network: string
  address: string
  derivationIndex: number
}

const { mockEnv, store, logger } = vi.hoisted(() => ({
  mockEnv: { TRON_MASTER_XPUB: undefined as string | undefined },
  store: {
    rows: [] as FakeRow[],
    // Per-create outcomes, consumed in order. 'ok' inserts; 'race-index'
    // simulates another ORDER grabbing our derivationIndex (P2002, no winner
    // for our orderId); 'race-order' simulates a concurrent call for the SAME
    // order winning (P2002 with the winning row now present).
    behaviors: [] as Array<'ok' | 'race-index' | 'race-order'>
  },
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

function p2002(): Error {
  return Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
}

const createMock = vi.fn(async (args: { data: FakeRow }): Promise<FakeRow> => {
  const behavior = store.behaviors.shift() ?? 'ok'
  if (behavior === 'race-index') {
    throw p2002()
  }
  if (behavior === 'race-order') {
    store.rows.push({ ...args.data, address: `WINNER_${args.data.orderId}` })
    throw p2002()
  }
  store.rows.push({ ...args.data })
  return { ...args.data }
})

vi.mock('../config/env.js', () => ({ env: mockEnv }))
vi.mock('../lib/logger.js', () => ({ logger }))
vi.mock('@tgshop/db', () => ({
  prisma: {
    depositAddress: {
      findUnique: vi.fn(async ({ where: { orderId } }: { where: { orderId: string } }) =>
        store.rows.find((r) => r.orderId === orderId) ?? null
      ),
      findFirst: vi.fn(async () =>
        store.rows.length === 0
          ? null
          : store.rows.reduce((max, r) => (r.derivationIndex > max.derivationIndex ? r : max))
      ),
      create: createMock
    }
  }
}))

const { allocateDepositAddress } = await import('../payments/tron.js')

const TRON_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/

beforeEach(() => {
  store.rows = []
  store.behaviors = []
  mockEnv.TRON_MASTER_XPUB = TEST_XPUB
  createMock.mockClear()
  logger.warn.mockClear()
})

describe('allocateDepositAddress', () => {
  it('derives a fresh on-curve TRON address and persists a watchable row', async () => {
    const address = await allocateDepositAddress('user_1', 'order_1')

    expect(address).toMatch(TRON_ADDRESS)
    expect(store.rows).toHaveLength(1)
    expect(store.rows[0]).toMatchObject({
      userId: 'user_1',
      orderId: 'order_1',
      // chain-sweep filters on exactly this — a wrong value strands funds.
      network: 'TRON',
      address,
      derivationIndex: 0
    })
  })

  it('reuses the existing address for an order instead of minting a second', async () => {
    store.rows.push({
      userId: 'user_1',
      orderId: 'order_1',
      network: 'TRON',
      address: 'TExistingAddress0000000000000000000',
      derivationIndex: 3
    })

    const address = await allocateDepositAddress('user_1', 'order_1')

    expect(address).toBe('TExistingAddress0000000000000000000')
    expect(createMock).not.toHaveBeenCalled()
  })

  it('allocates the next derivation index after the current maximum', async () => {
    store.rows.push({
      userId: 'user_9',
      orderId: 'order_old',
      network: 'TRON',
      address: 'TSomeOtherAddress000000000000000000',
      derivationIndex: 41
    })

    await allocateDepositAddress('user_1', 'order_new')

    const created = store.rows.find((r) => r.orderId === 'order_new')
    expect(created?.derivationIndex).toBe(42)
  })

  it('refuses to fabricate an address when TRON_MASTER_XPUB is unset', async () => {
    mockEnv.TRON_MASTER_XPUB = undefined
    await expect(allocateDepositAddress('user_1', 'order_1')).rejects.toThrow(/TRON_MASTER_XPUB/)
    expect(createMock).not.toHaveBeenCalled()
  })

  it('refuses to fabricate an address for a placeholder xpub', async () => {
    mockEnv.TRON_MASTER_XPUB = 'xpub-placeholder-value'
    await expect(allocateDepositAddress('user_1', 'order_1')).rejects.toThrow(/TRON_MASTER_XPUB/)
  })

  it('retries on a lost derivation-index race, then succeeds', async () => {
    store.behaviors = ['race-index', 'ok']

    const address = await allocateDepositAddress('user_1', 'order_1')

    expect(address).toMatch(TRON_ADDRESS)
    expect(createMock).toHaveBeenCalledTimes(2)
    expect(store.rows).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  it('collapses onto the winner when a concurrent call for the same order wins', async () => {
    store.behaviors = ['race-order']

    const address = await allocateDepositAddress('user_1', 'order_1')

    // Returns the winner's address; does NOT retry into a second derivation.
    expect(address).toBe('WINNER_order_1')
    expect(createMock).toHaveBeenCalledTimes(1)
  })

  it('gives up after exhausting retries under relentless index contention', async () => {
    store.behaviors = Array.from({ length: 8 }, () => 'race-index')

    await expect(allocateDepositAddress('user_1', 'order_1')).rejects.toThrow(/after 8 attempts/)
    expect(createMock).toHaveBeenCalledTimes(8)
  })
})
