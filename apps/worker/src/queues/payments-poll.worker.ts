import type { Job } from 'bullmq'
import { prisma, LedgerType, PaymentProvider, PaymentStatus, OrderStatus, Prisma } from '@tgshop/db'
import { credit } from '@tgshop/core'
import { createWorker, QueueName, newCorrelationId, upsertRepeatable } from '../queue.js'
import { jobLogger } from '../logger.js'
import { emitEvent } from '../events.js'
import { getCryptoBotClient } from '../lib/cryptobot.js'
import { enqueueDelivery } from './delivery.js'

// ─────────────────────────────────────────────────────────────────────────────
// payments-poll — fallback for CryptoBot webhooks that were missed. Every
// sweep, finds CRYPTOBOT Payment rows still PENDING/CONFIRMING, batches their
// providerInvoiceId, and calls getInvoices.
//
// An invoice reported "paid" splits four ways on the linked order's state:
//   - order still PENDING  -> settle exactly like the webhook handler would:
//     Payment -> PAID, Order -> PAID, enqueue delivery.
//   - no linked order and a `topup_*` reference -> a balance top-up whose
//     webhook was missed: Payment -> PAID and the balance credited under the
//     SAME ledger key the webhook uses (`topup:<paymentId>`), so however many
//     of the two paths run, the user is credited exactly once.
//   - order already closed (EXPIRED/FAILED/REFUNDED), or no order and no
//     top-up reference -> money with no live purchase. Payment -> PAID (the
//     provider's truth, and what stops the sweep re-selecting it), then flag
//     a reconcile mismatch: an AuditLog anomaly row for the admin timeline
//     and a payment.reconcile_mismatch event for agents. Deliberately NO
//     automatic crediting or resurrection — docs/AGENT_PLAN.md leaves
//     ambiguous money to a human.
//   - order PAID/DELIVERING/DELIVERED -> the webhook beat the poll; no-op.
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
    log.debug('CRYPTOBOT_API_TOKEN not configured, skipping payments-poll sweep')
    return
  }

  // Orders in ANY state, and orphan payments too: restricting this to
  // order.status=PENDING would blind the sweep to exactly the rows that
  // constitute a mismatch (paid invoice, closed order).
  const pending = await prisma.payment.findMany({
    where: {
      provider: PaymentProvider.CRYPTOBOT,
      status: { in: [PaymentStatus.PENDING, PaymentStatus.CONFIRMING] },
      providerInvoiceId: { not: null }
    },
    include: { order: { select: { status: true } } }
  })

  if (pending.length === 0) {
    log.info('payments-poll sweep: nothing pending')
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
      const invoiceAmountCents = parseUsdCents(invoice.amount)
      const expectedAmountCents = Number(payment.amount)
      if (
        invoiceAmountCents === null ||
        !Number.isSafeInteger(expectedAmountCents) ||
        invoiceAmountCents !== expectedAmountCents
      ) {
        await markAmountMismatch(payment, invoice, invoiceAmountCents, log)
        continue
      }
      if (await settlePaidInvoice(payment, log)) settledCount += 1
    } else if (invoice.status === 'expired' && payment.status === PaymentStatus.PENDING) {
      await prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.EXPIRED } })
    }
  }

  log.info({ checked: pending.length, settled: settledCount }, 'payments-poll sweep complete')
}

/** CryptoBot fiat invoices are USD amounts; parse them without floating point. */
function parseUsdCents(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null
  const [wholePart = '0', fractionPart = ''] = value.split('.')
  const whole = Number(wholePart)
  const cents = Number(fractionPart.padEnd(2, '0'))
  const result = whole * 100 + cents
  return Number.isSafeInteger(result) ? result : null
}

/**
 * A paid provider invoice with a different fiat amount is never auto-settled.
 * Marking it UNDERPAID stops an endless poll loop while retaining the provider
 * payload and an auditable high-severity record for manual reconciliation.
 */
async function markAmountMismatch(
  payment: { id: string; providerInvoiceId: string | null; orderId: string | null; amount: bigint; rawPayload: unknown },
  invoice: CryptoBotInvoiceLike,
  receivedAmountCents: number | null,
  log: ReturnType<typeof jobLogger>
): Promise<void> {
  const raw =
    payment.rawPayload && typeof payment.rawPayload === 'object' && !Array.isArray(payment.rawPayload)
      ? payment.rawPayload
      : {}
  const updated = await prisma.payment.updateMany({
    where: { id: payment.id, status: { in: [PaymentStatus.PENDING, PaymentStatus.CONFIRMING] } },
    data: {
      status: PaymentStatus.UNDERPAID,
      rawPayload: { ...(raw as Record<string, unknown>), polledInvoice: invoice } as unknown as Prisma.InputJsonValue
    }
  })
  if (updated.count === 0) return

  await prisma.auditLog.create({
    data: {
      actorType: 'system',
      actorId: 'worker.payments-poll',
      action: 'anomaly.flagged',
      entity: payment.orderId ? 'Order' : 'Payment',
      entityId: payment.orderId ?? payment.id,
      diff: {
        severity: 'high',
        category: 'payments',
        summary: 'CryptoBot reported a paid invoice with an amount different from the stored request',
        evidence: {
          paymentId: payment.id,
          providerInvoiceId: payment.providerInvoiceId,
          expectedAmountCents: Number(payment.amount),
          receivedAmountCents,
          invoice: invoice as unknown as Prisma.InputJsonValue
        }
      }
    }
  })
  log.error(
    { paymentId: payment.id, orderId: payment.orderId, expectedAmountCents: Number(payment.amount), receivedAmountCents },
    'CryptoBot paid invoice amount mismatch — refusing automatic settlement'
  )
}

/** Structural subset used by the mismatch recorder; keeps provider types local to this worker. */
interface CryptoBotInvoiceLike {
  invoice_id: number
  status: string
  hash: string
  asset: string
  amount: string
  paid_asset?: string
  paid_amount?: string
  paid_at?: string
}

/** Terminal order states: a paid invoice landing on one of these is a real provider/DB disagreement. */
const CLOSED_ORDER_STATUSES: readonly OrderStatus[] = [
  OrderStatus.EXPIRED,
  OrderStatus.FAILED,
  OrderStatus.REFUNDED
]

/** The `topup_*` reference stamped on the payment at invoice-creation time, or null. */
function topupReferenceOf(rawPayload: unknown): string | null {
  if (rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)) {
    const reference = (rawPayload as Record<string, unknown>)['reference']
    if (typeof reference === 'string' && reference.startsWith('topup_')) return reference
  }
  return null
}

/**
 * Settles a paid top-up invoice whose webhook never arrived: Payment -> PAID
 * and the user's balance credited, in one transaction.
 *
 * The claim (guarded updateMany) and the credit commit together, and the credit
 * runs under the same `topup:<paymentId>` idempotency key the webhook handler
 * uses — so poll-vs-webhook races, poll re-runs and webhook redeliveries all
 * collapse to exactly one credit.
 *
 * The credited amount is the payment row's own `amount` (USD cents, written at
 * invoice creation from what the user asked to top up), not the provider's
 * float string — the two are equal by construction and ours is integer-exact.
 */
async function settleMissedTopup(
  payment: { id: string; userId: string; amount: bigint; asset: string },
  log: ReturnType<typeof jobLogger>
): Promise<void> {
  const claimed = await prisma.$transaction(async (tx) => {
    const updated = await tx.payment.updateMany({
      where: {
        id: payment.id,
        status: { in: [PaymentStatus.PENDING, PaymentStatus.CONFIRMING] }
      },
      data: { status: PaymentStatus.PAID }
    })
    if (updated.count === 0) return false

    await credit(tx, {
      userId: payment.userId,
      amountCents: Number(payment.amount),
      type: LedgerType.TOPUP,
      paymentId: payment.id,
      idempotencyKey: `topup:${payment.id}`
    })
    return true
  })

  if (!claimed) {
    log.debug({ paymentId: payment.id }, 'top-up already settled elsewhere, poll is a no-op')
    return
  }

  // After commit, mirroring the webhook handler's announcement.
  await emitEvent('payment.received', {
    paymentId: payment.id,
    orderId: null,
    userId: payment.userId,
    provider: PaymentProvider.CRYPTOBOT,
    amount: payment.amount.toString(),
    asset: payment.asset,
    txHash: null
  })

  log.info(
    { paymentId: payment.id, userId: payment.userId, amountCents: Number(payment.amount) },
    'settled missed CryptoBot top-up via poll fallback'
  )
}

/**
 * Handles a provider-paid invoice whose order is closed (or missing): flips the
 * payment to PAID and records the disagreement.
 *
 * Exactly-once by construction: the guarded updateMany claims the still-pending
 * payment row inside the same transaction that writes the AuditLog anomaly row,
 * so two overlapping sweeps produce one flag, and the next sweep no longer
 * selects the payment at all. The audit row keeps the mismatch on the admin
 * timeline even with no stream consumer running (docs/PAYMENTS.md
 * "Reconciliation & anomaly detection"); the event is for agents
 * (docs/AGENT_PLAN.md capability 3).
 */
async function resolveMismatchedPaidInvoice(
  flag: {
    paymentId: string
    orderId: string | null
    kind: 'paid_no_order' | 'paid_order_closed'
    detail: string
  },
  log: ReturnType<typeof jobLogger>
): Promise<void> {
  const flagged = await prisma.$transaction(async (tx) => {
    const claimed = await tx.payment.updateMany({
      where: {
        id: flag.paymentId,
        status: { in: [PaymentStatus.PENDING, PaymentStatus.CONFIRMING] }
      },
      data: { status: PaymentStatus.PAID }
    })
    if (claimed.count === 0) return false

    await tx.auditLog.create({
      data: {
        actorType: 'system',
        actorId: 'worker.payments-poll',
        action: 'anomaly.flagged',
        entity: flag.orderId ? 'Order' : 'Payment',
        entityId: flag.orderId ?? flag.paymentId,
        diff: {
          severity: 'high',
          category: 'payments',
          summary: flag.detail,
          evidence: { provider: PaymentProvider.CRYPTOBOT, paymentId: flag.paymentId, kind: flag.kind }
        }
      }
    })
    return true
  })

  if (!flagged) return

  log.warn({ paymentId: flag.paymentId, orderId: flag.orderId, kind: flag.kind }, flag.detail)

  // After commit, so a rolled-back flag is never announced.
  await emitEvent('payment.reconcile_mismatch', {
    provider: PaymentProvider.CRYPTOBOT,
    paymentId: flag.paymentId,
    orderId: flag.orderId,
    kind: flag.kind,
    detail: flag.detail
  })
}

/**
 * Settles one polled-and-found-paid invoice. Returns whether THIS call is the
 * one that settled it.
 *
 * The return value is not cosmetic: the transaction below is a no-op when the
 * order has already left PENDING (the webhook beat the poll to it), and
 * announcing `payment.received` for that no-op would tell every consumer a
 * second payment arrived for an order that was only ever paid once.
 *
 * The no-op path splits further: an order that left PENDING by getting PAID
 * elsewhere is benign, but one that reached a terminal state (EXPIRED, FAILED,
 * REFUNDED) while the provider says "paid" is money with no live purchase —
 * that is exactly the `payment.reconcile_mismatch` docs/AGENT_PLAN.md wants
 * flagged for a human rather than guessed at automatically.
 */
async function settlePaidInvoice(
  payment: {
    id: string
    orderId: string | null
    userId: string
    amount: bigint
    asset: string
    rawPayload: unknown
  },
  log: ReturnType<typeof jobLogger>
): Promise<boolean> {
  const { id: paymentId, orderId, userId } = payment

  if (!orderId) {
    if (topupReferenceOf(payment.rawPayload) !== null) {
      await settleMissedTopup(payment, log)
    } else {
      await resolveMismatchedPaidInvoice(
        {
          paymentId,
          orderId: null,
          kind: 'paid_no_order',
          detail: 'CryptoBot reports the invoice paid, but the payment row is linked to no order and carries no top-up reference'
        },
        log
      )
    }
    return false
  }

  const outcome = await prisma.$transaction(async (tx) => {
    // Compare-and-set on the order row: a retried job racing the scheduled poll (or
    // the webhook) must not both observe PENDING and both emit payment.received.
    const claimed = await tx.order.updateMany({
      where: { id: orderId, status: OrderStatus.PENDING },
      data: { status: OrderStatus.PAID, paidAt: new Date() }
    })
    if (claimed.count === 0) {
      const order = await tx.order.findUnique({ where: { id: orderId }, select: { status: true } })
      return { settled: false, orderStatus: order?.status ?? null } as const
    }
    await tx.payment.update({ where: { id: paymentId }, data: { status: PaymentStatus.PAID } })
    return { settled: true, orderStatus: OrderStatus.PAID } as const
  })

  if (!outcome.settled) {
    if (outcome.orderStatus !== null && CLOSED_ORDER_STATUSES.includes(outcome.orderStatus)) {
      await resolveMismatchedPaidInvoice(
        {
          paymentId,
          orderId,
          kind: 'paid_order_closed',
          detail: `CryptoBot reports the invoice paid, but order ${orderId} is already ${outcome.orderStatus}`
        },
        log
      )
    } else {
      log.debug({ orderId, paymentId }, 'CryptoBot invoice already settled elsewhere, poll is a no-op')
    }
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
