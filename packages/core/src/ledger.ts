import type { Prisma, PrismaClient } from '@tgshop/db'
import { LedgerType } from '@tgshop/db'
import { InsufficientBalanceError, IdempotencyConflictError } from './errors.js'

// ─────────────────────────────────────────────────────────────────────────────
// Append-only ledger over BalanceTransaction.
//
// Concurrency strategy: we take a Postgres advisory lock keyed on the userId
// (pg_advisory_xact_lock, released automatically at transaction end) rather
// than relying on SERIALIZABLE isolation. Advisory locks are cheaper than
// SERIALIZABLE retries under contention, they exactly serialize concurrent
// credit/debit calls for the *same* user (which is all we need — different
// users never contend on the same balance), and unlike `SELECT ... FOR
// UPDATE` they don't require a physical row to lock, so top-ups for users
// with zero ledger rows still get correct mutual exclusion.
// ─────────────────────────────────────────────────────────────────────────────

export type PrismaTx = Prisma.TransactionClient

export interface LedgerEntryInput {
  userId: string
  amountCents: number
  type: LedgerType
  orderId?: string
  paymentId?: string
  comment?: string
  idempotencyKey: string
}

export interface LedgerEntryResult {
  id: string
  userId: string
  type: LedgerType
  amountCents: number
  balanceAfterCents: number
}

/** Locks the user's balance for the duration of the enclosing transaction. */
async function lockUserBalance(tx: PrismaTx, userId: string): Promise<void> {
  // hashtext() collapses the cuid string userId into a 32-bit int for the
  // advisory lock key; collisions only cause extra (harmless) serialization.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`
}

/** Sums all ledger entries for a user. Read this inside the same tx as any mutation for consistency. */
export async function getBalance(
  prisma: PrismaClient | PrismaTx,
  userId: string
): Promise<number> {
  const result = await prisma.balanceTransaction.aggregate({
    where: { userId },
    _sum: { amountCents: true }
  })
  return result._sum.amountCents ?? 0
}

/**
 * Returns the ledger row previously written for this idempotencyKey, if any,
 * by looking it up in the IdempotencyRecord table under scope "ledger".
 */
async function findExistingLedgerResult(
  tx: PrismaTx,
  idempotencyKey: string
): Promise<LedgerEntryResult | null> {
  const record = await tx.idempotencyRecord.findUnique({ where: { key: idempotencyKey } })
  if (!record) return null
  if (record.scope !== 'ledger') {
    throw new IdempotencyConflictError(idempotencyKey)
  }
  return record.resultJson as unknown as LedgerEntryResult
}

/**
 * Credits (adds funds to) a user's balance. Must run inside a Prisma
 * transaction supplied by the caller. Idempotent on idempotencyKey.
 */
export async function credit(
  tx: PrismaTx,
  input: LedgerEntryInput
): Promise<LedgerEntryResult> {
  if (input.amountCents <= 0) {
    throw new RangeError(`credit() amountCents must be positive, got ${input.amountCents}`)
  }
  return writeLedgerEntry(tx, input, input.amountCents)
}

/**
 * Debits (removes funds from) a user's balance. Must run inside a Prisma
 * transaction supplied by the caller. Refuses to let the balance go negative.
 * Idempotent on idempotencyKey.
 */
export async function debit(
  tx: PrismaTx,
  input: LedgerEntryInput
): Promise<LedgerEntryResult> {
  if (input.amountCents <= 0) {
    throw new RangeError(`debit() amountCents must be positive, got ${input.amountCents}`)
  }
  return writeLedgerEntry(tx, input, -input.amountCents)
}

async function writeLedgerEntry(
  tx: PrismaTx,
  input: LedgerEntryInput,
  signedAmountCents: number
): Promise<LedgerEntryResult> {
  const existing = await findExistingLedgerResult(tx, input.idempotencyKey)
  if (existing) return existing

  await lockUserBalance(tx, input.userId)

  const currentBalance = await getBalance(tx, input.userId)
  const newBalance = currentBalance + signedAmountCents
  if (newBalance < 0) {
    throw new InsufficientBalanceError(input.userId, -signedAmountCents, currentBalance)
  }

  const row = await tx.balanceTransaction.create({
    data: {
      userId: input.userId,
      type: input.type,
      amountCents: signedAmountCents,
      orderId: input.orderId,
      paymentId: input.paymentId,
      comment: input.comment
    }
  })

  const result: LedgerEntryResult = {
    id: row.id,
    userId: row.userId,
    type: row.type,
    amountCents: row.amountCents,
    balanceAfterCents: newBalance
  }

  await tx.idempotencyRecord.create({
    data: {
      key: input.idempotencyKey,
      scope: 'ledger',
      resultJson: result as unknown as Prisma.InputJsonValue
    }
  })

  return result
}
