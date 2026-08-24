import type { Job } from 'bullmq'
import { prisma } from '@tgshop/db'
import {
  createHttpExternalSupplier,
  fulfillOrder,
  type FulfillmentEmitter
} from '@tgshop/core'
import { createWorker, QueueName, newCorrelationId } from '../queue.js'
import { jobLogger } from '../logger.js'
import { sendTelegramMessage } from '../telegram.js'
import { resolveLocale, t } from '../i18n.js'
import { enqueueNotify } from './notify.js'
import { emitEvent } from '../events.js'
import type { DeliveryJobData } from './delivery.js'

// ─────────────────────────────────────────────────────────────────────────────
// delivery worker — a THIN adapter over @tgshop/core's fulfillOrder().
//
// This file used to carry a complete second implementation of the delivery
// pipeline that never called core, and it had drifted in three ways that broke
// real purchases on the rails that reach delivery through this queue (TRON, and
// the CryptoBot polling fallback):
//
//   • UNIQUE_CODE products were routed to the stock pool with no knowledge of
//     externalConfig.codeTemplate, so a template-minted product delivered fine
//     when paid with Stars and failed-and-refunded when paid with USDT;
//   • the DELIVERED status write sat OUTSIDE the stock transaction, and the
//     resume path matched RESERVED only. A crash between the two left the item
//     SOLD and unfindable, so every retry collided with the orderId unique
//     index until the attempts ran out — losing the credential AND the money;
//   • no Subscription row was ever created, so a subscription plan bought on
//     this path had no period, no renewal and no reminders.
//
// core owns all of it now: stock claiming under FOR UPDATE SKIP LOCKED, code
// minting, the order state machine, the subscription row, and fail-and-refund.
// What is left here is what a queue worker is actually for — retry accounting
// and telling the buyer and the admins what happened.
//
// MANUAL_FALLBACK is not a failure: core leaves the order in DELIVERING on
// purpose and an admin completes it out of band, so the job succeeds without
// marking DELIVERED.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Delivery wiring for the worker: the same supplier, event sink and settlement
 * rules the bot uses, so an order settles identically whichever rail paid it.
 */
const fulfillOptions = {
  supplier: createHttpExternalSupplier(prisma),
  emit: {
    orderDelivered: (e) => emitEvent('order.delivered', e),
    orderFailed: (e) => emitEvent('order.failed', e),
    stockLow: (e) => emitEvent('stock.low', e),
    stockDepleted: (e) => emitEvent('stock.depleted', e)
  } satisfies FulfillmentEmitter
}

async function processDelivery(job: Job<DeliveryJobData>): Promise<void> {
  const correlationId = newCorrelationId()
  const log = jobLogger(QueueName.Delivery, job.id, correlationId)
  const { orderId } = job.data

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { user: true }
  })

  if (!order) {
    log.warn({ orderId }, 'delivery job: order not found, dropping')
    return
  }

  let outcome
  try {
    outcome = await fulfillOrder(prisma, orderId, {
      ...fulfillOptions,
      onWarning: (message, context) => log.error(context, message)
    })
  } catch (err) {
    // core has already marked the order FAILED and refunded the buyer by the
    // time it throws, so there is nothing to settle here — only to report.
    // Re-throwing hands the job back to BullMQ for its retry/DLQ accounting;
    // fulfillOrder() is idempotent, so a retry either delivers or no-ops.
    log.error({ orderId, err }, 'delivery attempt failed')
    await notifyDeliveryFailed(order.user, orderId, err, log)
    throw err
  }

  if (outcome.status === 'manual') {
    await enqueueNotify({ kind: 'manual_fallback_sla', orderId, ageMinutes: 0 })
    log.info({ orderId }, 'order requires manual fallback delivery; admin notified')
    return
  }

  const locale = resolveLocale(order.user.languageCode)
  await sendTelegramMessage(order.user.tgId, buildDeliveredMessage(locale))
  log.info({ orderId }, 'order delivered successfully')
}

function buildDeliveredMessage(locale: 'ru' | 'en'): string {
  return locale === 'ru'
    ? '✅ Ваш заказ доставлен! Проверьте личные сообщения выше.'
    : '✅ Your order has been delivered! Check the message above.'
}

/**
 * Tells the buyer their money is back and raises the admin alert.
 *
 * Both sends are best-effort: the refund has already committed, so a Telegram
 * outage must not also cost us the retry accounting on the job itself.
 */
async function notifyDeliveryFailed(
  user: { tgId: bigint; languageCode: string | null },
  orderId: string,
  err: unknown,
  log: ReturnType<typeof jobLogger>
): Promise<void> {
  const reason = err instanceof Error ? err.message : String(err)
  const locale = resolveLocale(user.languageCode)

  await sendTelegramMessage(user.tgId, t(locale).deliveryFailedRefunded(orderId)).catch((sendErr) =>
    log.error({ sendErr, orderId }, 'failed to notify user of delivery failure')
  )
  await enqueueNotify({ kind: 'order_failed', orderId, reason }).catch((notifyErr) =>
    log.error({ notifyErr, orderId }, 'failed to enqueue admin alert for delivery failure')
  )
}

export function startDeliveryWorker() {
  return createWorker<DeliveryJobData, void>(QueueName.Delivery, processDelivery)
}
