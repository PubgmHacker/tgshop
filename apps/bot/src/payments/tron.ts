import { prisma } from '@tgshop/db'
import { env } from '../config/env.js'

/**
 * Allocates (or reuses) a deposit address for a USDT-TRC20 order.
 *
 * NOTE: this is a thin placeholder — real address derivation from
 * TRON_MASTER_XPUB (BIP32) and on-chain monitoring belongs to @tgshop/worker.
 * The bot only needs to hand the user *an* address and record the intent;
 * the worker owns confirmation polling and sweeping.
 */
export async function allocateDepositAddress(userId: string, orderId: string): Promise<string> {
  const existing = await prisma.depositAddress.findUnique({ where: { orderId } })
  if (existing) return existing.address

  const lastIndexRow = await prisma.depositAddress.findFirst({
    orderBy: { derivationIndex: 'desc' }
  })
  const nextIndex = (lastIndexRow?.derivationIndex ?? -1) + 1

  // Address derivation itself (from TRON_MASTER_XPUB) is out of scope for the
  // bot app; in absence of the worker's deriver we fail loudly rather than
  // fabricate an address, since misdirected USDT is unrecoverable.
  if (!env.TRON_MASTER_XPUB || env.TRON_MASTER_XPUB.startsWith('xpub-placeholder')) {
    throw new Error('TRON_MASTER_XPUB is not configured; cannot allocate a USDT-TRC20 deposit address')
  }

  throw new Error(
    'USDT-TRC20 address derivation is implemented by @tgshop/worker; bot cannot derive addresses locally. ' +
      `Requested derivation index would be ${nextIndex} for order ${orderId}/user ${userId}.`
  )
}
