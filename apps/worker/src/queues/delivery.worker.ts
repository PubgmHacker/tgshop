import type { Job } from 'bullmq'
import { prisma, OrderStatus, StockStatus, DeliveryType } from '@tgshop/db'
import { encrypt, decrypt } from '@tgshop/core'
import { credit, type PrismaTx } from '@tgshop/core'
import { LedgerType } from '@tgshop/db'
import { createWorker, QueueName, newCorrelationId } from '../queue.js'
import { jobLogger } from '../logger.js'
import { sendTelegramMessage } from '../telegram.js'
import { resolveLocale, t } from '../i18n.js'
import { enqueueNotify } from './notify.js'
import type { DeliveryJobData } from './delivery.js'
import { QUEUE_CONFIG } from '../queue.js'
import { DeliveryFailedError } from '@tgshop/core'

// ─────────────────────────────────────────────────────────────────────────────
// delivery worker: dispatches by Plan.product.deliveryType.
//
// STOCK_POOL / UNIQUE_CODE: both are served from the StockItem pool — a
// UNIQUE_CODE product is simply a pool where every item happens to be a
// one-off code, but the assignment/decrypt/re-encrypt mechanics are identical,
// so both types share the same code path below.
// EXTERNAL_API: calls Product.externalConfig.deliveryUrl with the order
// context and expects a JSON `{ payload: string }` response to encrypt+store.
// MANUAL_FALLBACK: leaves the order in DELIVERING and raises an admin alert;
// an admin completes delivery out-of-band (admin app), so this job succeeds
// without marking DELIVERED.
// ─────────────────────────────────────────────────────────────────────────────

async function processDelivery(job: Job<DeliveryJobData>): Promise<void> {
  const correlationId = newCorrelationId()
  const log = jobLogger(QueueName.Delivery, job.id, correlationId)
  const { orderId } = job.data

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { plan: { include: { product: true } }, user: true }
  })

  if (!order) {
    log.warn({ orderId }, 'delivery job: order not found, dropping')
    return
  }

  if (order.status === OrderStatus.DELIVERED) {
    log.info({ orderId }, 'delivery job: already delivered, skipping')
    return
  }

  if (order.status !== OrderStatus.PAID && order.status !== OrderStatus.DELIVERING) {
    log.warn({ orderId, status: order.status }, 'delivery job: order not in a deliverable state, skipping')
    return
  }

  await prisma.order.update({ where: { id: orderId }, data: { status: OrderStatus.DELIVERING } })

  try {
    const deliveryType = order.plan.product.deliveryType
    switch (deliveryType) {
      case DeliveryType.STOCK_POOL:
      case DeliveryType.UNIQUE_CODE:
        await deliverFromStockPool(order.id, order.planId)
        break
      case DeliveryType.EXTERNAL_API:
        await deliverFromExternalApi(order.id, order.planId, order.plan.product.externalConfig)
        break
      case DeliveryType.MANUAL_FALLBACK:
        await handleManualFallback(order.id, log)
        return // leave in DELIVERING, admin completes it
      default:
        throw new DeliveryFailedError(order.id, `unsupported deliveryType ${String(deliveryType)}`)
    }

    await prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.DELIVERED, deliveredAt: new Date() }
    })

    const locale = resolveLocale(order.user.languageCode)
    await sendTelegramMessage(order.user.tgId, buildDeliveredMessage(locale))
    log.info({ orderId }, 'order delivered successfully')
  } catch (err) {
    log.error({ orderId, err }, 'delivery attempt failed')
    const cfg = QUEUE_CONFIG[QueueName.Delivery]
    const isLastAttempt = job.attemptsMade + 1 >= cfg.attempts
    if (isLastAttempt) {
      await markFailedAndRefund(order.id, order.userId, order.amountCents, err, log)
    } else {
      // revert to PAID so a retry (or the next delivery job) can pick it up cleanly
      await prisma.order.update({ where: { id: orderId }, data: { status: OrderStatus.PAID } })
    }
    throw err
  }
}

function buildDeliveredMessage(locale: 'ru' | 'en'): string {
  return locale === 'ru' ? '✅ Ваш заказ доставлен! Проверьте личные сообщения выше.' : '✅ Your order has been delivered! Check the message above.'
}

async function deliverFromStockPool(orderId: string, planId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Prefer a stock item already RESERVED for this order (reserved at checkout time);
    // fall back to atomically claiming any AVAILABLE item for the plan.
    let item = await tx.stockItem.findFirst({
      where: { orderId, status: StockStatus.RESERVED }
    })

    if (!item) {
      const claimed = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE stock_items
        SET status = ${StockStatus.RESERVED}::"StockStatus", "orderId" = ${orderId}
        WHERE id = (
          SELECT id FROM stock_items
          WHERE "planId" = ${planId} AND status = ${StockStatus.AVAILABLE}::"StockStatus"
          ORDER BY "createdAt" ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id
      `
      const claimedId = claimed[0]?.id
      if (!claimedId) {
        throw new DeliveryFailedError(orderId, `no available stock for plan ${planId}`)
      }
      item = await tx.stockItem.findUniqueOrThrow({ where: { id: claimedId } })
    }

    // The stored payload is already ciphertext in our v1 format; decrypt then
    // re-encrypt into deliveredPayloadEnc so Order carries its own independent
    // ciphertext (allows StockItem payload rotation without touching history).
    const plaintext = decrypt(item.payloadEnc)
    const deliveredPayloadEnc = encrypt(plaintext)

    await tx.stockItem.update({ where: { id: item.id }, data: { status: StockStatus.SOLD, orderId } })
    await tx.order.update({ where: { id: orderId }, data: { deliveredPayloadEnc } })
  })
}

interface ExternalDeliveryConfig {
  deliveryUrl?: string
  headers?: Record<string, string>
}

async function deliverFromExternalApi(
  orderId: string,
  planId: string,
  externalConfig: unknown
): Promise<void> {
  const config = (externalConfig ?? {}) as ExternalDeliveryConfig
  if (!config.deliveryUrl) {
    throw new DeliveryFailedError(orderId, `plan ${planId} EXTERNAL_API product missing externalConfig.deliveryUrl`)
  }
  const res = await fetch(config.deliveryUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(config.headers ?? {}) },
    body: JSON.stringify({ orderId, planId })
  })
  if (!res.ok) {
    throw new DeliveryFailedError(orderId, `external delivery API returned HTTP ${res.status}`)
  }
  const body = (await res.json()) as { payload?: string }
  if (!body.payload) {
    throw new DeliveryFailedError(orderId, 'external delivery API returned no payload')
  }
  const deliveredPayloadEnc = encrypt(body.payload)
  await prisma.order.update({ where: { id: orderId }, data: { deliveredPayloadEnc } })
}

async function handleManualFallback(orderId: string, log: ReturnType<typeof jobLogger>): Promise<void> {
  await enqueueNotify({ kind: 'manual_fallback_sla', orderId, ageMinutes: 0 })
  log.info({ orderId }, 'order requires manual fallback delivery; admin notified')
}

async function markFailedAndRefund(
  orderId: string,
  userId: string,
  amountCents: number,
  err: unknown,
  log: ReturnType<typeof jobLogger>
): Promise<void> {
  const reason = err instanceof Error ? err.message : String(err)
  await prisma.$transaction(async (tx: PrismaTx) => {
    await tx.order.update({ where: { id: orderId }, data: { status: OrderStatus.FAILED } })
    // Release any stock item reserved for this order back to AVAILABLE.
    await tx.stockItem.updateMany({
      where: { orderId, status: StockStatus.RESERVED },
      data: { status: StockStatus.AVAILABLE, orderId: null }
    })
    await credit(tx, {
      userId,
      amountCents,
      type: LedgerType.REFUND,
      orderId,
      idempotencyKey: `delivery-failed-refund:${orderId}`,
      comment: `Auto-refund: delivery failed (${reason})`
    })
  })

  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (user) {
    const locale = resolveLocale(user.languageCode)
    await sendTelegramMessage(user.tgId, t(locale).deliveryFailedRefunded(orderId)).catch((sendErr) =>
      log.error({ sendErr, orderId }, 'failed to notify user of delivery failure')
    )
  }
  await enqueueNotify({ kind: 'order_failed', orderId, reason })
  log.error({ orderId, reason }, 'order marked FAILED and refunded to balance')
}

export function startDeliveryWorker() {
  return createWorker<DeliveryJobData, void>(QueueName.Delivery, processDelivery)
}
