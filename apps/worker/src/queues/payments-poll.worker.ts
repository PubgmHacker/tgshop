import type { Job } from 'bullmq'
import { prisma, PaymentProvider, PaymentStatus, OrderStatus } from '@tgshop/db'
import { createWorker, QueueName, newCorrelationId, upsertRepeatable } from '../queue.js'
import { jobLogger } from '../logger.js'
import { emitEvent } from '../events.js'
import { getCryptoBotClient } from '../lib/cryptobot.js'
import { enqueueDelivery } from './delivery.js'

// ─────────────────────────────────────────────────────────────────────────────
// payments:poll — fallback for CryptoBot webhooks that were missed. Every
// sweep, finds CRYPTOBOT Payment rows still PENDING/CONFIRMING whose Order is
// still PENDING, batches their providerInvoiceId, and calls getInvoices.
// Any invoice reported "paid" is settled exactly like the webhook handler
// would: Payment -> PAID, Order -> PAID, enqueue delivery.
// ─────────────────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 30 * 1000

export async function registerPaymentsPollRepeatables(): Promise<void> {
  await upsertRepeatable(QueueName.PaymentsPoll, 'poll-cryptobot', POLL_INTERVAL_MS)
}

async function processPaymentsPoll(job: Job<Record<string, never>>): Promise<void> {
  const correlationId = newCorrelationId()
  const log = jobLogger(QueueName.PaymentsPoll, job.id, correlationId)

  const client = getCryptoBotClient()
  if (!client) {
    log.debug('CRYPTOBOT_API_TOKEN not configured, skipping payments:poll sweep')
    return
  }

  const pending = await prisma.payment.findMany({
    where: {
      provider: PaymentProvider.CRYPTOBOT,
      status: { in: [PaymentStatus.PENDING, PaymentStatus.CONFIRMING] },
      providerInvoiceId: { not: null },
      order: { status: OrderStatus.PENDING }
    }
  })

  if (pending.length === 0) {
    log.info('payments:poll sweep: nothing pending')
    return
  }

  const invoiceIds = pending.map((p) => p.providerInvoiceId).filter((id): id is string => id !== null)
  const invoices = await client.getInvoices(invoiceIds)
  const invoiceById = new Map(invoices.map((inv) => [String(inv.invoice_id), inv]))

  let settledCount = 0
  for (const payment of pending) {
    const invoice = payment.providerInvoiceId ? invoiceById.get(payment.providerInvoiceId) : undefined
    if (!invoice) continue

    if (invoice.status === 'paid') {
      if (await settlePaidInvoice(payment, log)) settledCount += 1
    } else if (invoice.status === 'expired' && payment.status === PaymentStatus.PENDING) {
      await prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.EXPIRED } })
    }
  }

  log.info({ checked: pending.length, settled: settledCount }, 'payments:poll sweep complete')
}

/**
 * Settles one polled-and-found-paid invoice. Returns whether THIS call is the
 * one that settled it.
 *
 * The return value is not cosmetic: the transaction below is a no-op when the
 * order has already left PENDING (the webhook beat the poll to it), and
 * announcing `payment.received` for that no-op would tell every consumer a
 * second payment arrived for an order that was only ever paid once.
 */
async function settlePaidInvoice(
  payment: { id: string; orderId: string | null; userId: string; amount: bigint; asset: string },
  log: ReturnType<typeof jobLogger>
): Promise<boolean> {
  const { id: paymentId, orderId, userId } = payment

  if (!orderId) {
    log.warn({ paymentId }, 'paid CryptoBot invoice has no linked order, marking payment PAID only')
    await prisma.payment.update({ where: { id: paymentId }, data: { status: PaymentStatus.PAID } })
    return false
  }

  const settled = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } })
    if (!order || order.status !== OrderStatus.PENDING) return false

    await tx.payment.update({ where: { id: paymentId }, data: { status: PaymentStatus.PAID } })
    await tx.order.update({ where: { id: orderId }, data: { status: OrderStatus.PAID, paidAt: new Date() } })
    return true
  })

  if (!settled) {
    log.debug({ orderId, paymentId }, 'CryptoBot invoice already settled elsewhere, poll is a no-op')
    return false
  }

  // Ledger entries are not written here: CryptoBot direct purchases settle
  // straight to delivery without touching the balance ledger (ledger only
  // tracks balance top-ups/spend, not direct order payments).

  // After commit — an event published from inside the transaction would survive
  // a rollback the consumer cannot see. CryptoBot settles off-chain, so there is
  // no txHash to report.
  await emitEvent('payment.received', {
    paymentId,
    orderId,
    userId,
    provider: PaymentProvider.CRYPTOBOT,
    amount: payment.amount.toString(),
    asset: payment.asset,
    txHash: null
  })

  await enqueueDelivery(orderId)
  log.info({ orderId, paymentId, userId }, 'settled missed CryptoBot payment via poll fallback')
  return true
}

export function startPaymentsPollWorker() {
  return createWorker<Record<string, never>, void>(QueueName.PaymentsPoll, processPaymentsPoll)
}
