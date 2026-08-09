import type { Job } from 'bullmq'
import { prisma, OrderStatus, StockStatus } from '@tgshop/db'
import { createWorker, QueueName, newCorrelationId, upsertRepeatable } from '../queue.js'
import { jobLogger } from '../logger.js'
import { sendTelegramMessage } from '../telegram.js'
import { resolveLocale, t } from '../i18n.js'

// ─────────────────────────────────────────────────────────────────────────────
// orders:expire — repeatable job that cancels PENDING orders past their
// expiresAt and releases any RESERVED stock item back to AVAILABLE.
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

  for (const order of expired) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.order.update({ where: { id: order.id }, data: { status: OrderStatus.EXPIRED } })
        await tx.stockItem.updateMany({
          where: { orderId: order.id, status: StockStatus.RESERVED },
          data: { status: StockStatus.AVAILABLE, orderId: null }
        })
      })
      const locale = resolveLocale(order.user.languageCode)
      await sendTelegramMessage(order.user.tgId, t(locale).orderExpired(order.id)).catch((err) =>
        log.error({ err, orderId: order.id }, 'failed to notify user of order expiry')
      )
    } catch (err) {
      log.error({ err, orderId: order.id }, 'failed to expire order')
    }
  }

  log.info({ count: expired.length }, 'orders:expire sweep complete')
}

export function startOrdersExpireWorker() {
  return createWorker<Record<string, never>, void>(QueueName.OrdersExpire, processOrdersExpire)
}
