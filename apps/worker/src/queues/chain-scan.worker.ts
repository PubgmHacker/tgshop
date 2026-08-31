import type { Job } from 'bullmq'
import { prisma, PaymentProvider, PaymentStatus, OrderStatus, LedgerType } from '@tgshop/db'
import { credit } from '@tgshop/core'
import { createWorker, QueueName, newCorrelationId, upsertRepeatable } from '../queue.js'
import { jobLogger } from '../logger.js'
import { emitEvent } from '../events.js'
import { getTronGridClient } from '../lib/trongrid.js'
import { loadEnv } from '../env.js'
import { sendTelegramMessage } from '../telegram.js'
import { resolveLocale, t } from '../i18n.js'
import { enqueueDelivery } from './delivery.js'
import { enqueueNotify } from './notify.js'

// ─────────────────────────────────────────────────────────────────────────────
// chain-scan — repeatable TRON watcher. For every DepositAddress with an
// unswept balance interest (i.e. linked to an order still awaiting payment,
// or generally still active), scans TronGrid for TRC-20 transfers of the
// configured USDT contract to that address since the address's payment
// window started, and reconciles against the linked Payment/Order:
//
//   - amount >= expected, confirmations >= TRON_MIN_CONFIRMATIONS, order still
//     PENDING and not expired -> settle Payment PAID, Order PAID, enqueue
//     delivery.
//   - amount < expected -> mark Payment UNDERPAID, credit the received amount
//     (converted to USD cents at 1:1 USDT peg) to the user's balance, notify.
//   - amount > expected -> settle order normally, credit the surplus to
//     balance, notify.
//   - order already expired by the time payment lands -> credit full amount
//     to balance (do not deliver), notify.
// ─────────────────────────────────────────────────────────────────────────────

const SCAN_INTERVAL_MS = 20 * 1000

export async function registerChainScanRepeatables(): Promise<void> {
  await upsertRepeatable(QueueName.ChainScan, 'scan-tron-deposits', SCAN_INTERVAL_MS)
}

// USDT (like most TRC-20 stablecoins) uses 6 decimals, matching our internal
// USDT6 scale 1-for-1, so smallest-unit amounts convert straight to USD cents
// at the pegged rate without any additional scaling.
function usdt6ToUsdCents(amountUsdt6: bigint): number {
  return Number(amountUsdt6 / 10_000n) // 10^6 usdt6 units per USDT / 100 cents per USD = 10_000
}

/**
 * Announces that money actually landed on-chain, after the settling transaction
 * has committed.
 *
 * `payment.received` and `payment.underpaid` are deliberately mutually
 * exclusive: a consumer summing `payment.received.amount` is measuring revenue,
 * and a short payment that also announced itself as received would inflate that
 * total while the order was never paid for. An underpayment gets the underpaid
 * event alone, which carries the expected/received pair a consumer needs.
 *
 * The amount travels as a decimal string because it is a 6-decimal USDT
 * smallest-unit BigInt — JSON cannot represent it and a double would round it.
 */
async function emitPaymentReceived(
  order: NonNullable<DepositAddressWithOrder['order']>,
  paymentId: string,
  receivedUsdt6: bigint,
  txHash: string | null
): Promise<void> {
  await emitEvent('payment.received', {
    paymentId,
    orderId: order.id,
    userId: order.userId,
    provider: PaymentProvider.TRON_TRC20,
    amount: receivedUsdt6.toString(),
    asset: 'USDT',
    txHash
  })
}

async function processChainScan(job: Job<Record<string, never>>): Promise<void> {
  const correlationId = newCorrelationId()
  const log = jobLogger(QueueName.ChainScan, job.id, correlationId)
  const env = loadEnv()
  const client = getTronGridClient()

  try {
    const addresses = await prisma.depositAddress.findMany({
      where: { isSwept: false },
      include: { order: { include: { user: true, payments: true } } }
    })

    if (addresses.length === 0) {
      log.info('chain-scan sweep: no active deposit addresses')
      return
    }

    const latestBlock = await client.getLatestBlockNumber()

    for (const depositAddress of addresses) {
      try {
        await scanOneAddress(depositAddress, latestBlock, client, env, log)
      } catch (err) {
        log.error({ err, address: depositAddress.address }, 'chain-scan failed for address')
      }
    }

    log.info({ scanned: addresses.length }, 'chain-scan sweep complete')
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    log.error({ err }, 'chain-scan sweep errored')
    await enqueueNotify({ kind: 'chain_scan_error', reason })
    throw err
  }
}

type DepositAddressWithOrder = Awaited<ReturnType<typeof prisma.depositAddress.findMany>>[number] & {
  order:
    | (Awaited<ReturnType<typeof prisma.order.findFirst>> & {
        user: { languageCode: string | null; tgId: bigint }
        payments: Array<{ id: string; status: string; amount: bigint }>
      })
    | null
}

async function scanOneAddress(
  depositAddress: DepositAddressWithOrder,
  latestBlock: number,
  client: ReturnType<typeof getTronGridClient>,
  env: ReturnType<typeof loadEnv>,
  log: ReturnType<typeof jobLogger>
): Promise<void> {
  const order = depositAddress.order
  if (!order) return // address not linked to an order (e.g. pre-generated pool) — nothing to reconcile yet

  // A chain transfer can only settle an order that is still awaiting payment,
  // with one deliberate exception: an EXPIRED order still owns its deposit
  // address, so a late transfer must be credited to the user's balance rather
  // than silently stranded. DELIVERING/DELIVERED/FAILED/REFUNDED are excluded;
  // allowing those through would race delivery or resurrect a terminal order.
  if (order.status !== OrderStatus.PENDING && order.status !== OrderStatus.EXPIRED) return

  const transfers = await client.getTrc20TransfersTo(
    depositAddress.address,
    env.TRON_USDT_CONTRACT,
    depositAddress.createdAt.getTime()
  )
  if (transfers.length === 0) return

  const totalReceivedUsdt6 = transfers.reduce((sum, tr) => sum + BigInt(tr.value), 0n)
  if (totalReceivedUsdt6 === 0n) return

  const existingPayment = order.payments.find((p) => p.status !== 'FAILED')
  // Underpayments are cumulative: a buyer may send the missing amount later.
  // If the cumulative total has not changed, this scan already handled the
  // exact same transfers and must not repeat the user notification.
  if (existingPayment?.status === PaymentStatus.UNDERPAID && existingPayment.amount === totalReceivedUsdt6) return
  // A late payment is terminal by design. Ignore the same transfer set on the
  // next sweep after it has already been credited to the balance.
  if (order.status === OrderStatus.EXPIRED && existingPayment?.status === PaymentStatus.PAID) return

  // Confirmations approximated as block depth since the transfer's own block;
  // TronGrid does not return block_number directly in this endpoint response,
  // so we use latestBlock reached vs. transfer age as a proxy: require at
  // least TRON_MIN_CONFIRMATIONS * 3s (avg TRON block time) to have elapsed.
  const newestTransferMs = Math.max(...transfers.map((tr) => tr.block_timestamp))
  const elapsedMs = Date.now() - newestTransferMs
  const requiredMs = env.TRON_MIN_CONFIRMATIONS * 3_000
  if (elapsedMs < requiredMs) {
    log.debug({ orderId: order.id, elapsedMs, requiredMs }, 'chain-scan: awaiting confirmations')
    return
  }
  void latestBlock

  const expectedUsdt6 = BigInt(order.amountCents) * 10_000n
  const isExpired = order.expiresAt !== null && order.expiresAt.getTime() < Date.now()
  const txHash = transfers[0]?.transaction_id ?? null

  const paymentId =
    existingPayment?.id ??
    (
      await prisma.payment.create({
        data: {
          orderId: order.id,
          userId: order.userId,
          provider: PaymentProvider.TRON_TRC20,
          amount: totalReceivedUsdt6,
          asset: 'USDT',
          network: 'TRON',
          address: depositAddress.address,
          txHash,
          confirmations: env.TRON_MIN_CONFIRMATIONS,
          status: PaymentStatus.CONFIRMING,
          rawPayload: transfers as unknown as object
        }
      })
    ).id

  if (isExpired) {
    await settleLatePayment(order, paymentId, totalReceivedUsdt6, txHash, log)
    return
  }

  if (totalReceivedUsdt6 < expectedUsdt6) {
    await settleUnderpaid(order, paymentId, totalReceivedUsdt6, expectedUsdt6, log)
    return
  }

  if (totalReceivedUsdt6 > expectedUsdt6) {
    await settleOverpaid(order, paymentId, totalReceivedUsdt6, expectedUsdt6, txHash, log)
    return
  }

  await settleExact(order, paymentId, totalReceivedUsdt6, txHash, log)
}

async function settleExact(
  order: NonNullable<DepositAddressWithOrder['order']>,
  paymentId: string,
  receivedUsdt6: bigint,
  txHash: string | null,
  log: ReturnType<typeof jobLogger>
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: paymentId },
      data: { status: PaymentStatus.PAID, amount: receivedUsdt6 }
    })
    await tx.order.update({ where: { id: order.id }, data: { status: OrderStatus.PAID, paidAt: new Date() } })
  })
  await emitPaymentReceived(order, paymentId, receivedUsdt6, txHash)
  await enqueueDelivery(order.id)
  log.info({ orderId: order.id }, 'TRON payment settled exactly, order PAID')
}

async function settleUnderpaid(
  order: NonNullable<DepositAddressWithOrder['order']>,
  paymentId: string,
  receivedUsdt6: bigint,
  expectedUsdt6: bigint,
  log: ReturnType<typeof jobLogger>
): Promise<void> {
  const creditedCents = usdt6ToUsdCents(receivedUsdt6)
  await prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: paymentId },
      data: { status: PaymentStatus.UNDERPAID, amount: receivedUsdt6 }
    })
    if (creditedCents > 0) {
      await credit(tx, {
        userId: order.userId,
        amountCents: creditedCents,
        type: LedgerType.TOPUP,
        orderId: order.id,
        paymentId,
        idempotencyKey: `tron-underpaid:${paymentId}`,
        comment: `Underpayment credited to balance for order ${order.id}`
      })
    }
  })
  const shortfallUsdt6 = expectedUsdt6 - receivedUsdt6
  await emitEvent('payment.underpaid', {
    paymentId,
    orderId: order.id,
    expected6: expectedUsdt6.toString(),
    received6: receivedUsdt6.toString()
  })
  const shortfallDisplay = (Number(shortfallUsdt6) / 1_000_000).toFixed(2)
  await notifyUser(order, (locale) => t(locale).orderUnderpaid(shortfallDisplay, 'USDT'), log)
  log.warn({ orderId: order.id, shortfallUsdt6: shortfallUsdt6.toString() }, 'TRON payment underpaid')
}

async function settleOverpaid(
  order: NonNullable<DepositAddressWithOrder['order']>,
  paymentId: string,
  receivedUsdt6: bigint,
  expectedUsdt6: bigint,
  txHash: string | null,
  log: ReturnType<typeof jobLogger>
): Promise<void> {
  const surplusUsdt6 = receivedUsdt6 - expectedUsdt6
  const surplusCents = usdt6ToUsdCents(surplusUsdt6)
  await prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: paymentId },
      data: { status: PaymentStatus.PAID, amount: receivedUsdt6 }
    })
    await tx.order.update({ where: { id: order.id }, data: { status: OrderStatus.PAID, paidAt: new Date() } })
    if (surplusCents > 0) {
      await credit(tx, {
        userId: order.userId,
        amountCents: surplusCents,
        type: LedgerType.TOPUP,
        orderId: order.id,
        paymentId,
        idempotencyKey: `tron-overpaid:${paymentId}`,
        comment: `Overpayment surplus credited to balance for order ${order.id}`
      })
    }
  })
  await emitPaymentReceived(order, paymentId, receivedUsdt6, txHash)
  await enqueueDelivery(order.id)
  const surplusDisplay = (Number(surplusUsdt6) / 1_000_000).toFixed(2)
  await notifyUser(order, (locale) => t(locale).orderOverpaidCredited(surplusDisplay, 'USDT'), log)
  log.info({ orderId: order.id, surplusUsdt6: surplusUsdt6.toString() }, 'TRON payment overpaid, surplus credited')
}

async function settleLatePayment(
  order: NonNullable<DepositAddressWithOrder['order']>,
  paymentId: string,
  receivedUsdt6: bigint,
  txHash: string | null,
  log: ReturnType<typeof jobLogger>
): Promise<void> {
  const creditedCents = usdt6ToUsdCents(receivedUsdt6)
  await prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: paymentId },
      data: { status: PaymentStatus.PAID, amount: receivedUsdt6 }
    })
    if (creditedCents > 0) {
      await credit(tx, {
        userId: order.userId,
        amountCents: creditedCents,
        type: LedgerType.TOPUP,
        orderId: order.id,
        paymentId,
        idempotencyKey: `tron-late:${paymentId}`,
        comment: `Late payment (order expired) credited to balance for order ${order.id}`
      })
    }
  })
  const amountDisplay = (Number(receivedUsdt6) / 1_000_000).toFixed(2)
  await emitPaymentReceived(order, paymentId, receivedUsdt6, txHash)
  await notifyUser(order, (locale) => t(locale).latePaymentCredited(amountDisplay, 'USDT', order.id), log)
  log.warn({ orderId: order.id }, 'TRON payment arrived after expiry, credited to balance without delivery')
}

async function notifyUser(
  order: NonNullable<DepositAddressWithOrder['order']>,
  buildText: (locale: 'ru' | 'en') => string,
  log: ReturnType<typeof jobLogger>
): Promise<void> {
  const locale = resolveLocale(order.user.languageCode)
  await sendTelegramMessage(order.user.tgId, buildText(locale)).catch((err) =>
    log.error({ err, orderId: order.id }, 'failed to notify user from chain-scan')
  )
}

export function startChainScanWorker() {
  return createWorker<Record<string, never>, void>(QueueName.ChainScan, processChainScan)
}
