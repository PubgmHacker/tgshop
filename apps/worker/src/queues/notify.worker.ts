import type { Job } from 'bullmq'
import { prisma, OrderStatus } from '@tgshop/db'
import { getSetting } from '@tgshop/core'
import { createWorker, QueueName, newCorrelationId, upsertRepeatable } from '../queue.js'
import { getRedisConnection } from '../redis.js'
import { jobLogger } from '../logger.js'
import { notifyAdmins } from '../telegram.js'
import { adminStrings } from '../i18n.js'
import type { NotifyJobData } from './notify.js'

// ─────────────────────────────────────────────────────────────────────────────
// notify worker: sends admin alerts for the given kind, plus the repeatable
// "manual-fallback-sla-sweep" job which scans for MANUAL_FALLBACK orders
// stuck in DELIVERING beyond the SLA window and raises an alert for each.
// ─────────────────────────────────────────────────────────────────────────────

// The SLA itself is a live shop setting. A short fixed sweep interval keeps
// alert latency bounded even when an owner changes the SLA from the admin
// panel; the previous implementation baked in 30 minutes and ignored the
// configurable value entirely.
const SLA_SWEEP_INTERVAL_MS = 5 * 60 * 1000

/** Registers the repeatable manual-fallback SLA sweep. Idempotent — safe on every boot. */
export async function registerNotifyRepeatables(): Promise<void> {
  await upsertRepeatable(QueueName.Notify, 'manual-fallback-sla-sweep', SLA_SWEEP_INTERVAL_MS)
}

type NotifyJobPayload = NotifyJobData | Record<string, never>

async function processNotify(job: Job<NotifyJobPayload>): Promise<void> {
  const correlationId = newCorrelationId()
  const log = jobLogger(QueueName.Notify, job.id, correlationId)

  if (job.name === 'manual-fallback-sla-sweep') {
    await runManualFallbackSlaSweep(log)
    return
  }

  const data = job.data as NotifyJobData
  switch (data.kind) {
    case 'low_stock':
      await notifyAdmins(adminStrings.lowStock(data.planTitle, data.remaining, data.threshold))
      break
    case 'order_failed':
      await notifyAdmins(adminStrings.orderFailed(data.orderId, data.reason))
      break
    case 'manual_fallback_sla':
      await notifyAdmins(adminStrings.manualFallbackSla(data.orderId, data.ageMinutes))
      break
    case 'tron_unmatched':
      await notifyAdmins(
        adminStrings.tronUnmatched(data.amountDisplay, data.txHash, data.from, data.reason)
      )
      break
    case 'chain_scan_error':
      await notifyAdmins(adminStrings.chainScanError(data.reason))
      break
    default:
      log.warn({ data }, 'unknown notify job kind')
  }
}

async function runManualFallbackSlaSweep(log: ReturnType<typeof jobLogger>): Promise<void> {
  const slaMinutes = await getSetting(prisma, 'manual_fallback_sla_minutes', getRedisConnection())
  const cutoff = new Date(Date.now() - slaMinutes * 60 * 1000)
  const stuck = await prisma.order.findMany({
    where: {
      status: OrderStatus.DELIVERING,
      plan: { product: { deliveryType: 'MANUAL_FALLBACK' } },
      createdAt: { lt: cutoff }
    },
    select: { id: true, createdAt: true }
  })
  for (const order of stuck) {
    const ageMinutes = Math.floor((Date.now() - order.createdAt.getTime()) / 60_000)
    await notifyAdmins(adminStrings.manualFallbackSla(order.id, ageMinutes))
  }
  log.info({ count: stuck.length }, 'manual-fallback SLA sweep complete')
}

export function startNotifyWorker() {
  return createWorker<NotifyJobPayload, void>(QueueName.Notify, processNotify)
}
