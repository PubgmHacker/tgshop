import { prisma } from '@tgshop/db'
import { deriveAddress } from '@tgshop/payments'
import { env } from '../config/env.js'
import { logger } from '../lib/logger.js'

// ─────────────────────────────────────────────────────────────────────────────
// Allocates (or reuses) a USDT-TRC20 deposit address for an order.
//
// The address is derived BIP-32 style from the account-level extended PUBLIC
// key (TRON_MASTER_XPUB) at the DepositAddress.derivationIndex, using the exact
// same deriveAddress() the worker uses to scan and sweep — so the address a
// customer pays into and the address the worker later drains are provably the
// same. Only public-key material is needed here; the private key that signs
// sweeps lives solely in @tgshop/worker.
//
// Persisting the row is what puts the address on the worker's radar:
// chain-scan watches every DepositAddress with isSwept=false, and chain-sweep
// drains those with network='TRON'. An address handed to a user but not stored
// would silently swallow the customer's funds, so we store first, then return.
// ─────────────────────────────────────────────────────────────────────────────

/** Value chain-sweep filters on (`where: { isSwept: false, network: 'TRON' }`). */
const DEPOSIT_NETWORK = 'TRON'

/** derivationIndex, address and orderId are all UNIQUE; a lost race is retried this many times. */
const MAX_INDEX_RACE_RETRIES = 8

/** Postgres unique-constraint violation, detected structurally to avoid importing Prisma's runtime. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'P2002'
  )
}

/**
 * Returns a stable deposit address for `orderId`, creating one on first call.
 *
 * Idempotent per order: a repeat call (checkout re-poll, provider retry) returns
 * the same address rather than minting a second one. Concurrency-safe: parallel
 * allocations for *different* orders race on the unique derivationIndex, and the
 * loser re-reads the current maximum and retries; parallel calls for the *same*
 * order collapse onto the single winning row.
 */
export async function allocateDepositAddress(userId: string, orderId: string): Promise<string> {
  const existing = await prisma.depositAddress.findUnique({ where: { orderId } })
  if (existing) return existing.address

  // Fail loudly rather than fabricate an address — misdirected USDT is
  // unrecoverable, so a missing/placeholder xpub must never yield a "valid"
  // address the customer would send real funds to.
  if (!env.TRON_MASTER_XPUB || env.TRON_MASTER_XPUB.startsWith('xpub-placeholder')) {
    throw new Error(
      'TRON_MASTER_XPUB is not configured; cannot allocate a USDT-TRC20 deposit address'
    )
  }

  for (let attempt = 0; attempt < MAX_INDEX_RACE_RETRIES; attempt++) {
    const lastIndexRow = await prisma.depositAddress.findFirst({
      orderBy: { derivationIndex: 'desc' }
    })
    const nextIndex = (lastIndexRow?.derivationIndex ?? -1) + 1
    const address = deriveAddress(env.TRON_MASTER_XPUB, nextIndex)

    try {
      const created = await prisma.depositAddress.create({
        data: {
          userId,
          orderId,
          network: DEPOSIT_NETWORK,
          address,
          derivationIndex: nextIndex
        }
      })
      return created.address
    } catch (err) {
      if (!isUniqueViolation(err)) throw err

      // Some unique constraint fired. Either a concurrent call for THIS order
      // won (return its address — idempotent), or another order grabbed our
      // derivationIndex/address (re-read the max and try the next slot).
      const winner = await prisma.depositAddress.findUnique({ where: { orderId } })
      if (winner) return winner.address

      logger.warn({ orderId, userId, nextIndex, attempt }, 'deposit-address index race, retrying')
    }
  }

  throw new Error(
    `could not allocate a USDT-TRC20 deposit address for order ${orderId} after ${MAX_INDEX_RACE_RETRIES} attempts`
  )
}
