import { loadEnv } from './env.js'
import { logger } from './logger.js'
import { prisma } from '@tgshop/db'
import { closeRedisConnection } from './redis.js'
import { closeAllWorkers, getActiveWorkers } from './queue.js'
import { startHealthServer } from './health.js'

import { startPaymentsPollWorker, registerPaymentsPollRepeatables } from './queues/payments-poll.worker.js'
import { startChainScanWorker, registerChainScanRepeatables } from './queues/chain-scan.worker.js'
import { startChainSweepWorker, registerChainSweepRepeatables } from './queues/chain-sweep.worker.js'
import { startDeliveryWorker } from './queues/delivery.worker.js'
import { startOrdersExpireWorker, registerOrdersExpireRepeatables } from './queues/orders-expire.worker.js'
import { startSubsRemindWorker, registerSubsRemindRepeatables } from './queues/subs-remind.worker.js'
import { startBroadcastWorker, registerBroadcastRepeatables } from './queues/broadcast.worker.js'
import { startNotifyWorker, registerNotifyRepeatables } from './queues/notify.worker.js'

export { enqueueDelivery } from './queues/delivery.js'
export { enqueueBroadcast } from './queues/broadcast.js'
export { enqueueNotify } from './queues/notify.js'

async function main(): Promise<void> {
  loadEnv() // fail fast on misconfiguration before starting anything
  logger.info('tgshop-worker starting')

  const health = await startHealthServer()

  // Start all BullMQ Workers first so they're ready to pick up jobs the
  // moment repeatable schedulers begin enqueuing them.
  startPaymentsPollWorker()
  startChainScanWorker()
  startChainSweepWorker()
  startDeliveryWorker()
  startOrdersExpireWorker()
  startSubsRemindWorker()
  startBroadcastWorker()
  startNotifyWorker()

  // Idempotent repeatable job registration — safe to run on every boot,
  // including rolling restarts with multiple worker replicas.
  await Promise.all([
    registerPaymentsPollRepeatables(),
    registerChainScanRepeatables(),
    registerChainSweepRepeatables(),
    registerOrdersExpireRepeatables(),
    registerSubsRemindRepeatables(),
    registerBroadcastRepeatables(),
    registerNotifyRepeatables()
  ])

  logger.info('tgshop-worker ready: all queues started, repeatable schedules registered')

  let shuttingDown = false
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info({ signal }, 'shutdown signal received, draining in-flight jobs')

    try {
      await health.close()
    } catch (err) {
      logger.error({ err }, 'error closing health server')
    }

    try {
      // Worker.close() waits for currently-processing jobs to finish before
      // resolving, giving us graceful draining rather than abrupt kills.
      await closeAllWorkers()
    } catch (err) {
      logger.error({ err }, 'error closing workers')
    }

    try {
      await closeRedisConnection()
    } catch (err) {
      logger.error({ err }, 'error closing redis connection')
    }

    try {
      await prisma.$disconnect()
    } catch (err) {
      logger.error({ err }, 'error disconnecting prisma')
    }

    logger.info('tgshop-worker shutdown complete')
    process.exit(0)
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'unhandledRejection')
  })
  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'uncaughtException')
  })

  logger.info({ activeWorkers: getActiveWorkers().length }, 'boot sequence finished')
}

main().catch((err) => {
  logger.error({ err }, 'fatal error during worker boot')
  process.exit(1)
})
