import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LedgerType } from '@tgshop/db'
import { credit, debit, getBalance, type LedgerEntryResult } from '@tgshop/core'
import { createFixture, prisma, requireDefined, topUp, type TestFixture } from './setup.js'

// ─────────────────────────────────────────────────────────────────────────────
// Ledger idempotency against the real IdempotencyRecord table.
//
// Payment providers resend webhooks and workers retry jobs, so the same
// idempotencyKey WILL arrive twice. Once must mean once: one BalanceTransaction
// row, one movement of the balance, and the replay must return the result the
// first call recorded rather than a fresh row.
// ─────────────────────────────────────────────────────────────────────────────

const TOP_UP_CENTS = 2_500
const DEBIT_CENTS = 700

describe('ledger idempotency', () => {
  let fixture: TestFixture

  beforeAll(async () => {
    fixture = await createFixture({ stockCount: 0 })
  })

  afterAll(async () => {
    await fixture.cleanup()
  })

  it('credits once when the same idempotencyKey is applied twice', async () => {
    const key = fixture.key('topup-twice')
    const input = {
      userId: fixture.user.id,
      amountCents: TOP_UP_CENTS,
      type: LedgerType.TOPUP,
      idempotencyKey: key,
      comment: 'replayed top-up'
    }

    const first: LedgerEntryResult = await prisma.$transaction((tx) => credit(tx, input))
    const second: LedgerEntryResult = await prisma.$transaction((tx) => credit(tx, input))

    // The replay returns the recorded result, not a new row.
    expect(second.id).toBe(first.id)
    expect(second.amountCents).toBe(first.amountCents)
    expect(second.balanceAfterCents).toBe(first.balanceAfterCents)

    const rows = await prisma.balanceTransaction.findMany({ where: { userId: fixture.user.id } })
    expect(rows).toHaveLength(1)
    expect(requireDefined(rows[0], 'the credit row').amountCents).toBe(TOP_UP_CENTS)

    expect(await getBalance(prisma, fixture.user.id)).toBe(TOP_UP_CENTS)
  })

  it('records exactly one IdempotencyRecord, scoped to the ledger', async () => {
    const record = requireDefined(
      await prisma.idempotencyRecord.findUnique({ where: { key: fixture.key('topup-twice') } }),
      'the ledger idempotency record'
    )
    expect(record.scope).toBe('ledger')
    expect(record.resultJson).not.toBeNull()
  })

  it('debits once when the same idempotencyKey is applied twice', async () => {
    const key = fixture.key('debit-twice')
    const input = {
      userId: fixture.user.id,
      amountCents: DEBIT_CENTS,
      type: LedgerType.PURCHASE,
      idempotencyKey: key
    }

    const before = await getBalance(prisma, fixture.user.id)
    const first = await prisma.$transaction((tx) => debit(tx, input))
    const second = await prisma.$transaction((tx) => debit(tx, input))

    expect(second.id).toBe(first.id)
    expect(first.amountCents).toBe(-DEBIT_CENTS)
    expect(await getBalance(prisma, fixture.user.id)).toBe(before - DEBIT_CENTS)
  })

  it('keeps distinct keys independent', async () => {
    const before = await getBalance(prisma, fixture.user.id)
    await topUp(fixture.user.id, 100, fixture.key('extra-a'))
    await topUp(fixture.user.id, 100, fixture.key('extra-b'))
    expect(await getBalance(prisma, fixture.user.id)).toBe(before + 200)
  })
})
