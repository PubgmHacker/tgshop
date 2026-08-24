import type { Job } from 'bullmq'
import { prisma, OrderStatus } from '@tgshop/db'
import { expireOrder } from '@tgshop/core'
import { createWorker, QueueName, newCorrelationId, upsertRepeatable } from '../queue.js'
import { jobLogger } from '../logger.js'
import { sendTelegramMessage } from '../telegram.js'
import { resolveLocale, t } from '../i18n.js'

// ─────────────────────────────────────────────────────────────────────────────
// orders-expire — repeatable job that cancels PENDING orders past their
// expiresAt, returns any RESERVED stock item to the pool, and hands back the
// promo use the order claimed when it was created.
//
// All three of those live in core's expireOrder(); this worker only supplies the
// scan and the customer notification. It used to do its own `order.update` plus
// a bulk `stockItem.updateMany`, which skipped assertTransition and never
// released the promo — so every abandoned order permanently burned a use of a
// capped promo code. apps/bot/src/domain/orders.ts::expirePendingOrders was
// already correct; this is the same shape, so the two cannot drift.
// ─────────────────────────────────────────────────────────────────────────────

const EXPIRE_SWEEP_INTERVAL_MS = 60 * 1000

export async function registerOrdersExpireRepeatables(): Promise<void> {
  await upsertRepeatable(QueueName.OrdersExpire, 'expire-sweep', EXPIRE_SWEEP_INTERVAL_MS)
}

async function processOrdersExpire(job: Job<Record<string, never>>): Promise<void> {
  const correlationId = newCorrelationId()
  const log = jobLogger(QueueName.OrdersExpire, job.id, correlationId)

  const expired = await prisma.order.findMany({
    where: { status: OrderStatus.PENDING, expiresAt: { lt: new Date() } },
    include: { user: true }
  })

  let expiredCount = 0
  for (const order of expired) {
    try {
      await prisma.$transaction((tx) => expireOrder(tx, order.id))
      expiredCount += 1

      // Only after the transaction commits: telling a customer their order
      // expired and then rolling the expiry back would be the one lie this job
      // must not tell.
      const locale = resolveLocale(order.user.languageCode)
      await sendTelegramMessage(order.user.tgId, t(locale).orderExpired(order.id)).catch((err) =>
        log.error({ err, orderId: order.id }, 'failed to notify user of order expiry')
      )
    } catch (err) {
      // A payment may have moved the order out of PENDING between the scan and
      // this transaction, in which case assertTransition refuses it. Losing that
      // race is correct behaviour, not an outage.
      log.warn({ err, orderId: order.id }, 'could not expire order')
    }
  }

  log.info({ expired: expiredCount, scanned: expired.length }, 'orders-expire sweep complete')
}

export function startOrdersExpireWorker() {
  return createWorker<Record<string, never>, void>(QueueName.OrdersExpire, processOrdersExpire)
}
