import type { Job } from 'bullmq'
import { prisma, Prisma, PaymentProvider, PaymentStatus, OrderStatus, LedgerType } from '@tgshop/db'
import { credit, resolveTronReceiveAddress, usdt6ToDisplay, usdt6ToUsdCents } from '@tgshop/core'
import { createWorker, QueueName, newCorrelationId, upsertRepeatable } from '../queue.js'
import { jobLogger } from '../logger.js'
import { emitEvent } from '../events.js'
import { getTronGridClient, type TronTrc20Transfer } from '../lib/trongrid.js'
import { matchTransfer, type InvoiceStatus, type OpenInvoice } from '../lib/tron-match.js'
import { loadEnv } from '../env.js'
import { sendTelegramMessage } from '../telegram.js'
import { resolveLocale, t } from '../i18n.js'
import { enqueueDelivery } from './delivery.js'
import { enqueueNotify } from './notify.js'

// ─────────────────────────────────────────────────────────────────────────────
// chain-scan — repeatable, read-only TRON watcher over ONE static wallet.
//
// Every customer pays into the owner's own USDT-TRC20 address. The bot gives
// each open invoice a unique sub-cent tag on its amount (29.0057 USDT), so the
// amount of an inbound transfer says which invoice it belongs to. Each scan:
//
//   1. lists confirmed USDT transfers INTO the wallet (TronGrid, lookback),
//   2. drops transfers already recorded (Payment.txHash) or already flagged
//      (AuditLog anomaly) — that is the idempotency layer,
//   3. matches the rest to open invoices (lib/tron-match.ts) and settles:
//        order PENDING, in window, amount >= tagged  -> Order PAID, delivery
//                                                       (surplus -> balance)
//        order PENDING, amount short                 -> Payment UNDERPAID,
//                                                       received -> balance
//        order expired / paid another way            -> received -> balance
//        top-up (no order)                           -> received -> balance
//        nothing matches                             -> AuditLog anomaly +
//                                                       admin alert, never
//                                                       a guess.
//
// Nothing here can move funds: there are no keys in the system at all.
// ─────────────────────────────────────────────────────────────────────────────

const SCAN_INTERVAL_MS = 20 * 1000

/**
 * Mirrors apps/bot (domain/payments.ts PAYMENT_WINDOW_MS + payments/tron.ts
 * TRON_TAG_GRACE_MS): an invoice holds its tag for window + grace, so only
 * invoices younger than that may claim a transfer. Considering older ones would
 * make a reissued tag ambiguous; considering fewer would drop a legit late payer.
 */
const PAYMENT_WINDOW_MS = 20 * 60 * 1000
const TAG_GRACE_MS = 30 * 60 * 1000
const TAG_HOLD_MS = PAYMENT_WINDOW_MS + TAG_GRACE_MS

/**
 * How far back the wallet is read. Longer than the tag hold on purpose: after a
 * worker outage every transfer in this window is still discovered and either
 * settled or flagged for a human, instead of silently never being looked at.
 */
const SCAN_LOOKBACK_MS = 6 * 60 * 60 * 1000

/** Average TRON block time; confirmations are approximated as elapsed time. */
const TRON_BLOCK_MS = 3_000

const AUDIT_ENTITY = 'TronTransfer'
const AUDIT_ACTOR = 'worker.chain-scan'

let warnedNoAddress = false
// Idle sweeps log at debug; an info heartbeat on the first sweep after boot and then
// every HEARTBEAT_EVERY_SWEEPS proves the repeatable is firing and TronGrid is reachable.
const HEARTBEAT_EVERY_SWEEPS = 45 // 45 × 20 s ≈ 15 min
let sweepCount = 0

export async function registerChainScanRepeatables(): Promise<void> {
  await upsertRepeatable(QueueName.ChainScan, 'scan-tron-deposits', SCAN_INTERVAL_MS)
}

const invoiceInclude = {
  user: { select: { id: true, tgId: true, languageCode: true } },
  order: { select: { id: true, status: true, expiresAt: true, userId: true } }
} satisfies Prisma.PaymentInclude

type InvoiceRow = Prisma.PaymentGetPayload<{ include: typeof invoiceInclude }>

/** An open invoice as the matcher sees it, carrying its database row along. */
interface Candidate extends OpenInvoice {
  row: InvoiceRow
}

function orderIsClosed(order: InvoiceRow['order'], now: number): boolean {
  if (!order) return false
  if (order.status !== OrderStatus.PENDING) return true
  return order.expiresAt !== null && order.expiresAt.getTime() < now
}

function toCandidate(row: InvoiceRow, now: number): Candidate {
  const status: InvoiceStatus =
    row.status === PaymentStatus.PENDING && orderIsClosed(row.order, now)
      ? 'EXPIRED'
      : (row.status as InvoiceStatus)
  return {
    id: row.id,
    amountUsdt6: BigInt(row.amount),
    status,
    txHash: row.txHash,
    createdAt: row.createdAt,
    row
  }
}

/** Every TRON invoice that may still claim a transfer (holds its tag). */
async function loadCandidates(now: number): Promise<Candidate[]> {
  const rows = await prisma.payment.findMany({
    where: {
      provider: PaymentProvider.TRON_TRC20,
      status: {
        in: [
          PaymentStatus.PENDING,
          PaymentStatus.CONFIRMING,
          PaymentStatus.UNDERPAID,
          PaymentStatus.EXPIRED
        ]
      },
      createdAt: { gte: new Date(now - TAG_HOLD_MS) }
    },
    include: invoiceInclude
  })
  return rows.map((row) => toCandidate(row, now))
}

function isConfirmed(transfer: TronTrc20Transfer, minConfirmations: number, now: number): boolean {
  return now - transfer.block_timestamp >= minConfirmations * TRON_BLOCK_MS
}

function transferPayload(
  transfer: TronTrc20Transfer,
  receivedUsdt6: bigint
): Prisma.InputJsonValue {
  return {
    transfer: transfer as unknown as Prisma.InputJsonValue,
    receivedUsdt6: receivedUsdt6.toString()
  }
}

async function processChainScan(job: Job<Record<string, never>>): Promise<void> {
  const correlationId = newCorrelationId()
  const log = jobLogger(QueueName.ChainScan, job.id, correlationId)
  const env = loadEnv()
  const receiveAddress = resolveTronReceiveAddress(env)

  if (!receiveAddress) {
    if (!warnedNoAddress) {
      log.warn(
        'chain-scan idle: TRON_RECEIVE_ADDRESS (or legacy TRON_SWEEP_TO_ADDRESS) is not a valid TRON address'
      )
      warnedNoAddress = true
    }
    return
  }

  try {
    const now = Date.now()
    sweepCount += 1
    await expireStaleInvoices(now)

    const transfers = await getTronGridClient().getTrc20TransfersTo(
      receiveAddress,
      env.TRON_USDT_CONTRACT,
      now - SCAN_LOOKBACK_MS
    )
    if (transfers.length === 0) {
      if (sweepCount === 1 || sweepCount % HEARTBEAT_EVERY_SWEEPS === 0) {
        log.info(
          { sweep: sweepCount, lookbackHours: SCAN_LOOKBACK_MS / 3_600_000 },
          'chain-scan alive: no inbound USDT transfers in window'
        )
      } else {
        log.debug('chain-scan: no inbound USDT transfers in window')
      }
      return
    }

    const txids = transfers.map((tr) => tr.transaction_id)
    const [recorded, flagged] = await Promise.all([
      prisma.payment.findMany({
        where: { provider: PaymentProvider.TRON_TRC20, txHash: { in: txids } },
        include: invoiceInclude
      }),
      prisma.auditLog.findMany({
        where: { entity: AUDIT_ENTITY, entityId: { in: txids } },
        select: { entityId: true }
      })
    ])
    const recordedByTx = new Map(recorded.map((p) => [p.txHash as string, p]))
    const flaggedTx = new Set(flagged.map((a) => a.entityId))
    const candidates = await loadCandidates(now)

    let settled = 0
    let waiting = 0
    let unmatched = 0
    // Oldest first: if two transfers compete for one invoice the earlier one wins it.
    for (const transfer of [...transfers].sort((a, b) => a.block_timestamp - b.block_timestamp)) {
      const txid = transfer.transaction_id
      if (flaggedTx.has(txid)) continue
      const receivedUsdt6 = BigInt(transfer.value)
      const confirmed = isConfirmed(transfer, env.TRON_MIN_CONFIRMATIONS, now)

      try {
        const known = recordedByTx.get(txid)
        if (known) {
          // Bound on an earlier scan while still confirming; settle once deep enough.
          if (known.status !== PaymentStatus.CONFIRMING) continue
          if (!confirmed) {
            waiting += 1
            continue
          }
          await settle(known, expectedFor(known, candidates), receivedUsdt6, transfer, now, log)
          settled += 1
          continue
        }

        const match = matchTransfer({ txid, amountUsdt6: receivedUsdt6 }, candidates)
        if (match.kind === 'unmatched') {
          await flagUnmatched(transfer, receivedUsdt6, match.reason, log)
          flaggedTx.add(txid)
          unmatched += 1
          continue
        }
        if (match.kind === 'already-recorded') continue

        const invoice = match.invoice
        const bound = await bindTransfer(invoice, receiveAddress, transfer, receivedUsdt6)
        // The invoice now carries this tx; a second transfer in the same batch must not claim it too.
        invoice.txHash = bound.txHash
        recordedByTx.set(txid, bound)
        if (!confirmed) {
          waiting += 1
          log.info(
            { paymentId: bound.id, txid },
            'chain-scan: transfer bound, awaiting confirmations'
          )
          continue
        }
        await settle(bound, invoice.amountUsdt6, receivedUsdt6, transfer, now, log)
        settled += 1
      } catch (err) {
        log.error({ err, txid }, 'chain-scan: failed to process transfer')
      }
    }

    log.info(
      { transfers: transfers.length, settled, waiting, unmatched },
      'chain-scan sweep complete'
    )
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    log.error({ err }, 'chain-scan sweep errored')
    await enqueueNotify({ kind: 'chain_scan_error', reason })
    throw err
  }
}

/**
 * A TRON invoice nobody ever paid stops holding its tag after window + grace;
 * flip it to EXPIRED so top-ups (which have no order to expire them) do not
 * linger as PENDING forever. Invoices with a bound transfer are left alone.
 */
async function expireStaleInvoices(now: number): Promise<void> {
  await prisma.payment.updateMany({
    where: {
      provider: PaymentProvider.TRON_TRC20,
      status: PaymentStatus.PENDING,
      txHash: null,
      createdAt: { lt: new Date(now - TAG_HOLD_MS) }
    },
    data: { status: PaymentStatus.EXPIRED }
  })
}

/**
 * The amount the customer was asked to send. A row created for a second
 * transfer on an UNDERPAID invoice stores the received amount, so the expected
 * amount is read back from the original invoice (same order, oldest row).
 */
function expectedFor(row: InvoiceRow, candidates: Candidate[]): bigint {
  if (row.orderId) {
    const original = candidates
      .filter((c) => c.row.orderId === row.orderId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]
    if (original) return original.amountUsdt6
  }
  return BigInt(row.amount)
}

/**
 * Records the transfer on the invoice. A fresh invoice takes the tx itself; an
 * UNDERPAID invoice already carries its first tx, so a second transfer gets its
 * own Payment row on the same order — (provider, txHash) is unique and every
 * on-chain transfer deserves its own audit trail.
 */
async function bindTransfer(
  invoice: Candidate,
  receiveAddress: string,
  transfer: TronTrc20Transfer,
  receivedUsdt6: bigint
): Promise<InvoiceRow> {
  const rawPayload = transferPayload(transfer, receivedUsdt6)
  if (invoice.txHash === null) {
    return prisma.payment.update({
      where: { id: invoice.id },
      data: {
        txHash: transfer.transaction_id,
        address: receiveAddress,
        status: PaymentStatus.CONFIRMING,
        rawPayload
      },
      include: invoiceInclude
    })
  }
  return prisma.payment.create({
    data: {
      orderId: invoice.row.orderId,
      userId: invoice.row.userId,
      provider: PaymentProvider.TRON_TRC20,
      amount: receivedUsdt6,
      asset: 'USDT',
      network: invoice.row.network,
      address: receiveAddress,
      txHash: transfer.transaction_id,
      status: PaymentStatus.CONFIRMING,
      rawPayload
    },
    include: invoiceInclude
  })
}

/** Nobody can claim this money: leave a durable trace (also the dedupe key) and wake an admin. */
async function flagUnmatched(
  transfer: TronTrc20Transfer,
  receivedUsdt6: bigint,
  reason: string,
  log: ReturnType<typeof jobLogger>
): Promise<void> {
  const amountDisplay = usdt6ToDisplay(receivedUsdt6, 4)
  await prisma.auditLog.create({
    data: {
      actorType: 'system',
      actorId: AUDIT_ACTOR,
      action: 'anomaly.flagged',
      entity: AUDIT_ENTITY,
      entityId: transfer.transaction_id,
      diff: {
        severity: 'medium',
        category: 'payments',
        summary: 'USDT transfer on the receive wallet matches no open invoice; credit by hand',
        evidence: {
          txHash: transfer.transaction_id,
          from: transfer.from,
          amountUsdt6: receivedUsdt6.toString(),
          amountDisplay,
          reason,
          blockTimestamp: transfer.block_timestamp
        }
      }
    }
  })
  await enqueueNotify({
    kind: 'tron_unmatched',
    txHash: transfer.transaction_id,
    from: transfer.from,
    amountDisplay,
    reason
  })
  log.warn(
    { txid: transfer.transaction_id, reason, amountDisplay },
    'chain-scan: unmatched transfer flagged'
  )
}

type Log = ReturnType<typeof jobLogger>

/** Routes a confirmed, bound transfer to the one outcome it can have. */
async function settle(
  row: InvoiceRow,
  expectedUsdt6: bigint,
  receivedUsdt6: bigint,
  transfer: TronTrc20Transfer,
  now: number,
  log: Log
): Promise<void> {
  const txid = transfer.transaction_id
  if (!row.orderId || !row.order) return settleTopup(row, receivedUsdt6, txid, log)
  if (orderIsClosed(row.order, now)) return settleLate(row, receivedUsdt6, txid, log)
  if (receivedUsdt6 < expectedUsdt6) return settleUnderpaid(row, expectedUsdt6, receivedUsdt6, log)
  return settleOrderPaid(row, expectedUsdt6, receivedUsdt6, txid, log)
}

async function settleOrderPaid(
  row: InvoiceRow,
  expectedUsdt6: bigint,
  receivedUsdt6: bigint,
  txid: string,
  log: Log
): Promise<void> {
  const orderId = row.orderId as string
  const surplusUsdt6 = receivedUsdt6 - expectedUsdt6
  const surplusCents = usdt6ToUsdCents(surplusUsdt6)

  const outcome = await prisma.$transaction(async (tx) => {
    // Compare-and-swap rather than core's markPaid(): markPaid() hands back an
    // already-PAID order untouched, which cannot tell "this transfer paid it"
    // from "balance/CryptoBot paid it a second ago" — and that difference
    // decides whether the money buys the goods or lands on the balance.
    const claimed = await tx.order.updateMany({
      where: { id: orderId, status: OrderStatus.PENDING },
      data: { status: OrderStatus.PAID, paidAt: new Date(), externalId: txid }
    })
    if (claimed.count === 0) return 'closed' as const
    await tx.payment.update({
      where: { id: row.id },
      data: { status: PaymentStatus.PAID, amount: receivedUsdt6 }
    })
    if (surplusCents > 0) {
      await credit(tx, {
        userId: row.userId,
        amountCents: surplusCents,
        type: LedgerType.TOPUP,
        orderId,
        paymentId: row.id,
        idempotencyKey: `tron-overpaid:${row.id}`,
        comment: `Overpayment surplus credited to balance for order ${orderId}`
      })
    }
    return 'paid' as const
  })

  if (outcome === 'closed') return settleLate(row, receivedUsdt6, txid, log)

  await emitPaymentReceived(row, receivedUsdt6, txid)
  await enqueueDelivery(orderId)
  if (surplusCents > 0) {
    await notifyUser(
      row.user,
      (locale) => t(locale).orderOverpaidCredited(usdt6ToDisplay(surplusUsdt6), 'USDT'),
      log
    )
  }
  log.info(
    { orderId, paymentId: row.id, surplusUsdt6: surplusUsdt6.toString() },
    'TRON payment settled, order PAID'
  )
}

async function settleUnderpaid(
  row: InvoiceRow,
  expectedUsdt6: bigint,
  receivedUsdt6: bigint,
  log: Log
): Promise<void> {
  const creditedCents = usdt6ToUsdCents(receivedUsdt6)
  await prisma.$transaction(async (tx) => {
    // `amount` stays the tagged ask: an UNDERPAID invoice still holds its tag so
    // the customer can re-send the full amount and be recognised.
    await tx.payment.update({
      where: { id: row.id },
      data: { status: PaymentStatus.UNDERPAID, amount: expectedUsdt6 }
    })
    if (creditedCents > 0) {
      await credit(tx, {
        userId: row.userId,
        amountCents: creditedCents,
        type: LedgerType.TOPUP,
        orderId: row.orderId ?? undefined,
        paymentId: row.id,
        idempotencyKey: `tron-underpaid:${row.id}`,
        comment: `Underpayment credited to balance for order ${row.orderId}`
      })
    }
  })
  await emitEvent('payment.underpaid', {
    paymentId: row.id,
    orderId: row.orderId,
    expected6: expectedUsdt6.toString(),
    received6: receivedUsdt6.toString()
  })
  const shortfallUsdt6 = expectedUsdt6 - receivedUsdt6
  await notifyUser(
    row.user,
    (locale) => t(locale).orderUnderpaid(usdt6ToDisplay(shortfallUsdt6), 'USDT'),
    log
  )
  log.warn(
    { orderId: row.orderId, paymentId: row.id, shortfallUsdt6: shortfallUsdt6.toString() },
    'TRON payment underpaid'
  )
}

/** The order is gone (expired, or paid another way first): the money goes to the balance, never lost. */
async function settleLate(
  row: InvoiceRow,
  receivedUsdt6: bigint,
  txid: string,
  log: Log
): Promise<void> {
  const creditedCents = usdt6ToUsdCents(receivedUsdt6)
  await prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: row.id },
      data: { status: PaymentStatus.PAID, amount: receivedUsdt6 }
    })
    if (creditedCents > 0) {
      await credit(tx, {
        userId: row.userId,
        amountCents: creditedCents,
        type: LedgerType.TOPUP,
        orderId: row.orderId ?? undefined,
        paymentId: row.id,
        idempotencyKey: `tron-late:${row.id}`,
        comment: `Late payment (order closed) credited to balance for order ${row.orderId}`
      })
    }
  })
  await emitPaymentReceived(row, receivedUsdt6, txid)
  await notifyUser(
    row.user,
    (locale) =>
      t(locale).latePaymentCredited(usdt6ToDisplay(receivedUsdt6), 'USDT', row.orderId ?? ''),
    log
  )
  log.warn(
    { orderId: row.orderId, paymentId: row.id },
    'TRON payment arrived for a closed order, credited to balance'
  )
}

/** A top-up credits whatever arrived under the same ledger key the CryptoBot rail uses. */
async function settleTopup(
  row: InvoiceRow,
  receivedUsdt6: bigint,
  txid: string,
  log: Log
): Promise<void> {
  const creditedCents = usdt6ToUsdCents(receivedUsdt6)
  await prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: row.id },
      data: { status: PaymentStatus.PAID, amount: receivedUsdt6 }
    })
    if (creditedCents > 0) {
      await credit(tx, {
        userId: row.userId,
        amountCents: creditedCents,
        type: LedgerType.TOPUP,
        paymentId: row.id,
        idempotencyKey: `topup:${row.id}`,
        comment: 'USDT-TRC20 balance top-up'
      })
    }
  })
  await emitPaymentReceived(row, receivedUsdt6, txid)
  await notifyUser(
    row.user,
    (locale) => t(locale).topupCredited(usdt6ToDisplay(receivedUsdt6), 'USDT'),
    log
  )
  log.info({ paymentId: row.id, creditedCents }, 'TRON top-up credited')
}

/**
 * `payment.received` and `payment.underpaid` stay mutually exclusive: a consumer
 * summing received amounts measures revenue, and a short payment must not
 * inflate it. Amounts travel as decimal strings (6-decimal BigInt, JSON-unsafe).
 */
async function emitPaymentReceived(
  row: InvoiceRow,
  receivedUsdt6: bigint,
  txid: string
): Promise<void> {
  await emitEvent('payment.received', {
    paymentId: row.id,
    orderId: row.orderId,
    userId: row.userId,
    provider: PaymentProvider.TRON_TRC20,
    amount: receivedUsdt6.toString(),
    asset: 'USDT',
    txHash: txid
  })
}

async function notifyUser(
  user: InvoiceRow['user'],
  buildText: (locale: 'ru' | 'en') => string,
  log: Log
): Promise<void> {
  const locale = resolveLocale(user.languageCode)
  await sendTelegramMessage(user.tgId, buildText(locale)).catch((err) =>
    log.error({ err, userId: user.id }, 'failed to notify user from chain-scan')
  )
}

export function startChainScanWorker() {
  return createWorker<Record<string, never>, void>(QueueName.ChainScan, processChainScan)
}
