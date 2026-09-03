import { describe, it, expect, vi } from 'vitest'
import { LedgerType } from '@tgshop/db'
import type { PrismaTx } from '../ledger.js'
import { credit, debit, getBalance } from '../ledger.js'
import { IdempotencyConflictError, InsufficientBalanceError } from '../errors.js'

// ─────────────────────────────────────────────────────────────────────────────
// Mocked Prisma transaction client. The ledger is append-only, so the fake keeps
// a row array and derives the balance from a SUM, exactly like the real query.
// $executeRaw is the per-user advisory lock; the fake records who was locked.
// ─────────────────────────────────────────────────────────────────────────────

interface LedgerRow {
  userId: string
  amountCents: number
  type: LedgerType
}

function makeTx(initial: LedgerRow[] = []) {
  const rows: LedgerRow[] = [...initial]
  const idempotency = new Map<string, { scope: string; resultJson: unknown }>()
  const locks: string[] = []

  const api = {
    balanceTransaction: {
      aggregate: vi.fn(async (args: { where: { userId: string } }) => {
        const forUser = rows.filter((row) => row.userId === args.where.userId)
        const sum = forUser.reduce((total, row) => total + row.amountCents, 0)
        // Prisma returns null, not 0, when no rows match.
        return { _sum: { amountCents: forUser.length === 0 ? null : sum } }
      }),
      create: vi.fn(async (args: { data: LedgerRow }) => {
        rows.push(args.data)
        return { id: `bt_${rows.length}`, createdAt: new Date(), ...args.data }
      })
    },
    idempotencyRecord: {
      findUnique: vi.fn(async (args: { where: { key: string } }) => {
        const found = idempotency.get(args.where.key)
        return found ? { key: args.where.key, createdAt: new Date(), ...found } : null
      }),
      create: vi.fn(async (args: { data: { key: string; scope: string; resultJson: unknown } }) => {
        if (idempotency.has(args.data.key)) throw new Error('fake tx: duplicate idempotency key')
        idempotency.set(args.data.key, { scope: args.data.scope, resultJson: args.data.resultJson })
        return { createdAt: new Date(), ...args.data }
      })
    },
    $executeRaw: vi.fn(async (_query: unknown, ...values: unknown[]) => {
      locks.push(String(values[0] ?? ''))
      return 1
    })
  }

  return { tx: api as unknown as PrismaTx, api, rows, locks, idempotency }
}

const funded: LedgerRow[] = [{ userId: 'user_1', amountCents: 5000, type: LedgerType.TOPUP }]

describe('getBalance', () => {
  it('returns zero for a user with no rows', async () => {
    const { tx } = makeTx()
    await expect(getBalance(tx, 'user_1')).resolves.toBe(0)
  })

  it('sums credits and debits', async () => {
    const { tx } = makeTx([
      { userId: 'user_1', amountCents: 5000, type: LedgerType.TOPUP },
      { userId: 'user_1', amountCents: -1299, type: LedgerType.PURCHASE }
    ])
    await expect(getBalance(tx, 'user_1')).resolves.toBe(3701)
  })

  it('ignores other users', async () => {
    const { tx } = makeTx([{ userId: 'user_2', amountCents: 9999, type: LedgerType.TOPUP }])
    await expect(getBalance(tx, 'user_1')).resolves.toBe(0)
  })
})

describe('credit', () => {
  it('appends a positive row and reports the balance after', async () => {
    const { tx, rows } = makeTx()
    const result = await credit(tx, {
      userId: 'user_1',
      amountCents: 2500,
      type: LedgerType.TOPUP,
      idempotencyKey: 'topup_1'
    })

    expect(result.amountCents).toBe(2500)
    expect(result.balanceAfterCents).toBe(2500)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ amountCents: 2500, type: LedgerType.TOPUP })
  })

  it('rejects a non-positive amount', async () => {
    const { tx } = makeTx()
    for (const amountCents of [0, -1]) {
      await expect(
        credit(tx, {
          userId: 'user_1',
          amountCents,
          type: LedgerType.TOPUP,
          idempotencyKey: `bad_${amountCents}`
        })
      ).rejects.toThrow(RangeError)
    }
  })

  it('serializes on the user before reading the balance', async () => {
    const { tx, locks, api } = makeTx()
    await credit(tx, {
      userId: 'user_1',
      amountCents: 100,
      type: LedgerType.TOPUP,
      idempotencyKey: 'lock_1'
    })

    expect(locks).toContain('user_1')
    expect(api.$executeRaw).toHaveBeenCalled()
    // The lock must be taken before the read that decides the new balance.
    const lockOrder = api.$executeRaw.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER
    const readOrder =
      api.balanceTransaction.aggregate.mock.invocationCallOrder[0] ?? Number.MIN_SAFE_INTEGER
    expect(lockOrder).toBeLessThan(readOrder)
  })
})

describe('debit', () => {
  it('appends a negative row and reports the balance after', async () => {
    const { tx, rows } = makeTx(funded)
    const result = await debit(tx, {
      userId: 'user_1',
      amountCents: 1299,
      type: LedgerType.PURCHASE,
      orderId: 'order_1',
      idempotencyKey: 'purchase_1'
    })

    expect(result.amountCents).toBe(-1299)
    expect(result.balanceAfterCents).toBe(3701)
    expect(rows).toHaveLength(2)
    expect(rows[1]).toMatchObject({ amountCents: -1299, type: LedgerType.PURCHASE })
  })

  it('allows spending down to exactly zero', async () => {
    const { tx } = makeTx(funded)
    const result = await debit(tx, {
      userId: 'user_1',
      amountCents: 5000,
      type: LedgerType.PURCHASE,
      idempotencyKey: 'purchase_all'
    })
    expect(result.balanceAfterCents).toBe(0)
  })

  it('refuses to drive the balance negative and writes nothing', async () => {
    const { tx, rows, api } = makeTx(funded)

    await expect(
      debit(tx, {
        userId: 'user_1',
        amountCents: 5001,
        type: LedgerType.PURCHASE,
        idempotencyKey: 'purchase_over'
      })
    ).rejects.toThrow(InsufficientBalanceError)

    expect(rows).toHaveLength(1)
    expect(api.balanceTransaction.create).not.toHaveBeenCalled()
    expect(api.idempotencyRecord.create).not.toHaveBeenCalled()
  })

  it('refuses any debit on an empty balance', async () => {
    const { tx } = makeTx()
    const failure = debit(tx, {
      userId: 'user_1',
      amountCents: 1,
      type: LedgerType.PURCHASE,
      idempotencyKey: 'purchase_empty'
    })

    await expect(failure).rejects.toThrow(InsufficientBalanceError)
    await expect(failure).rejects.toThrow(/insufficient balance/i)
  })

  it('rejects a non-positive amount', async () => {
    const { tx } = makeTx(funded)
    await expect(
      debit(tx, {
        userId: 'user_1',
        amountCents: 0,
        type: LedgerType.PURCHASE,
        idempotencyKey: 'zero'
      })
    ).rejects.toThrow(RangeError)
  })
})

describe('idempotency', () => {
  it('short-circuits a repeated credit and returns the stored result', async () => {
    const { tx, rows, api } = makeTx()
    const input = {
      userId: 'user_1',
      amountCents: 2500,
      type: LedgerType.TOPUP,
      idempotencyKey: 'topup_abc'
    }

    const first = await credit(tx, input)
    const second = await credit(tx, input)

    expect(second).toEqual(first)
    expect(rows).toHaveLength(1)
    expect(api.balanceTransaction.create).toHaveBeenCalledTimes(1)
    // The lock is taken BEFORE the idempotency lookup, on every call: two
    // concurrent writers with the same key must serialize, or both would miss
    // the record and both would insert. A replay therefore costs one lock too.
    expect(api.$executeRaw).toHaveBeenCalledTimes(2)
    const firstLock = api.$executeRaw.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER
    const lookup = api.idempotencyRecord.findUnique.mock.invocationCallOrder[0] ?? -1
    expect(firstLock).toBeLessThan(lookup)
  })

  it('short-circuits a repeated debit', async () => {
    const { tx, rows } = makeTx(funded)
    const input = {
      userId: 'user_1',
      amountCents: 1299,
      type: LedgerType.PURCHASE,
      idempotencyKey: 'purchase_xyz'
    }

    const first = await debit(tx, input)
    const second = await debit(tx, input)

    expect(second).toEqual(first)
    expect(rows).toHaveLength(2)
  })

  it('keeps distinct keys independent', async () => {
    const { tx, rows } = makeTx()
    await credit(tx, {
      userId: 'user_1',
      amountCents: 1000,
      type: LedgerType.TOPUP,
      idempotencyKey: 'k1'
    })
    const second = await credit(tx, {
      userId: 'user_1',
      amountCents: 1000,
      type: LedgerType.TOPUP,
      idempotencyKey: 'k2'
    })

    expect(rows).toHaveLength(2)
    expect(second.balanceAfterCents).toBe(2000)
  })

  it('rejects a key already used by another scope', async () => {
    const { tx, idempotency } = makeTx()
    idempotency.set('shared_key', { scope: 'orders', resultJson: { id: 'order_1' } })

    await expect(
      credit(tx, {
        userId: 'user_1',
        amountCents: 100,
        type: LedgerType.TOPUP,
        idempotencyKey: 'shared_key'
      })
    ).rejects.toThrow(IdempotencyConflictError)
  })
})
