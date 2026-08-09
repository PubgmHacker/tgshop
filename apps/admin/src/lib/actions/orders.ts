'use server'

import { revalidatePath } from 'next/cache'
import { prisma, AdminRole, OrderStatus, StockStatus, LedgerType, type Prisma } from '@tgshop/db'
import { credit } from '@tgshop/core'
import { requireRole } from '../rbac'
import { writeAuditLog } from '../audit'
import {
  orderFilterSchema,
  orderRedeliverSchema,
  orderRefundSchema,
  type OrderFilterInput,
  type OrderRedeliverInput,
  type OrderRefundInput
} from '../schemas'

/**
 * Statuses a re-delivery is allowed from. Widened to `OrderStatus[]` on purpose:
 * a bare array literal narrows to its members, and `.includes(order.status)`
 * would then be a type error rather than a runtime check.
 */
const REDELIVERABLE_STATUSES: readonly OrderStatus[] = [
  OrderStatus.DELIVERED,
  OrderStatus.PAID,
  OrderStatus.FAILED
]

export async function listOrdersAction(input: OrderFilterInput) {
  requireRole(AdminRole.SUPPORT)
  const data = orderFilterSchema.parse(input)

  const where: Prisma.OrderWhereInput = {
    ...(data.status ? { status: data.status as OrderStatus } : {}),
    ...(data.provider ? { provider: data.provider } : {}),
    ...(data.userId ? { userId: data.userId } : {}),
    ...(data.query
      ? {
          OR: [{ id: data.query }, { externalId: { contains: data.query, mode: 'insensitive' } }]
        }
      : {}),
    ...(data.dateFrom || data.dateTo
      ? {
          createdAt: {
            ...(data.dateFrom ? { gte: data.dateFrom } : {}),
            ...(data.dateTo ? { lte: data.dateTo } : {})
          }
        }
      : {})
  }

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (data.page - 1) * data.pageSize,
      take: data.pageSize,
      include: { user: true, plan: { include: { product: true } }, payments: true }
    }),
    prisma.order.count({ where })
  ])

  return { orders, total, page: data.page, pageSize: data.pageSize }
}

export async function getOrderDetailAction(orderId: string) {
  requireRole(AdminRole.SUPPORT)
  return prisma.order.findUnique({
    where: { id: orderId },
    include: {
      user: true,
      plan: { include: { product: true } },
      payments: true,
      stockItem: true,
      promo: true,
      ledgerEntries: true
    }
  })
}

/**
 * Re-delivers an order: re-attaches the already-reserved StockItem's ciphertext
 * (or, if none, throws) to Order.deliveredPayloadEnc and marks it DELIVERED again.
 * Does not touch stock counts — this is for resending an existing delivery, not
 * granting a new item.
 */
export async function redeliverOrderAction(input: OrderRedeliverInput) {
  const session = requireRole(AdminRole.ADMIN)
  const data = orderRedeliverSchema.parse(input)

  const order = await prisma.order.findUnique({ where: { id: data.orderId }, include: { stockItem: true } })
  if (!order) {
    throw new Error(`Order not found: ${data.orderId}`)
  }
  if (!REDELIVERABLE_STATUSES.includes(order.status)) {
    throw new Error(`Order ${data.orderId} is in status ${order.status} and cannot be re-delivered`)
  }

  const payloadEnc = order.deliveredPayloadEnc ?? order.stockItem?.payloadEnc
  if (!payloadEnc) {
    throw new Error(`Order ${data.orderId} has no stored payload to re-deliver`)
  }

  const updated = await prisma.order.update({
    where: { id: data.orderId },
    data: {
      status: OrderStatus.DELIVERED,
      deliveredPayloadEnc: payloadEnc,
      deliveredAt: new Date()
    }
  })

  await writeAuditLog({
    actorId: session.adminId,
    action: 'order.redeliver',
    entity: 'Order',
    entityId: data.orderId
  })

  revalidatePath(`/orders/${data.orderId}`)
  revalidatePath('/orders')
  return updated
}

/**
 * Refunds an order: releases its stock item back to AVAILABLE (so it can be
 * resold), credits the user's balance via the ledger (append-only,
 * LedgerType.REFUND), and marks the order REFUNDED. All in one transaction.
 */
export async function refundOrderAction(input: OrderRefundInput) {
  const session = requireRole(AdminRole.ADMIN)
  const data = orderRefundSchema.parse(input)

  const order = await prisma.order.findUnique({ where: { id: data.orderId }, include: { stockItem: true } })
  if (!order) {
    throw new Error(`Order not found: ${data.orderId}`)
  }
  if (order.status === OrderStatus.REFUNDED) {
    throw new Error(`Order ${data.orderId} is already refunded`)
  }

  const idempotencyKey = `refund:${data.orderId}`

  const result = await prisma.$transaction(async (tx) => {
    const ledgerResult = await credit(tx, {
      userId: order.userId,
      amountCents: order.amountCents,
      type: LedgerType.REFUND,
      orderId: order.id,
      comment: data.reason,
      idempotencyKey
    })

    if (order.stockItem) {
      await tx.stockItem.update({
        where: { id: order.stockItem.id },
        data: { status: StockStatus.AVAILABLE, orderId: null, reservedUntil: null }
      })
    }

    const updatedOrder = await tx.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.REFUNDED }
    })

    return { ledgerResult, updatedOrder }
  })

  await writeAuditLog({
    actorId: session.adminId,
    action: 'order.refund',
    entity: 'Order',
    entityId: data.orderId,
    diff: { reason: data.reason, amountCents: order.amountCents }
  })

  revalidatePath(`/orders/${data.orderId}`)
  revalidatePath('/orders')
  return result
}
