'use server'

import { revalidatePath } from 'next/cache'
import { prisma, AdminRole, OrderStatus, type Prisma } from '@tgshop/db'
import {
  getBalance,
  markDelivered,
  markDelivering,
  refundOrder,
  OrderStateError
} from '@tgshop/core'
import { requireRole } from '../rbac'
import { writeAuditLog } from '../audit'
import { canRedeliverOrder, canRefundOrder } from '../orders-policy'
import {
  orderFilterSchema,
  orderRedeliverSchema,
  orderRefundSchema,
  type OrderFilterInput,
  type OrderRedeliverInput,
  type OrderRefundInput
} from '../schemas'

/**
 * Turns core's state-machine error into something an operator can act on.
 *
 * OrderStateError's own message names the graph edge ("PENDING -> REFUNDED"),
 * which is the right text for a log and the wrong text for a support agent
 * staring at a button that just failed.
 */
function describeStateError(err: unknown, action: string, orderId: string): never {
  if (err instanceof OrderStateError) {
    throw new Error(`Order ${orderId} is in status ${err.from} and cannot be ${action}`)
  }
  throw err
}

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
 * Re-delivers an order: re-attaches the already-issued ciphertext to
 * Order.deliveredPayloadEnc and marks it DELIVERED again.
 *
 * This is for re-sending something the buyer already owns — a lost message, a
 * MANUAL_FALLBACK order an admin has now fulfilled by hand — so it deliberately
 * claims NO new stock. The payload comes from the order itself when it has one
 * (template-minted UNIQUE_CODE plans never touch the pool) and otherwise from
 * the stock item already reserved for it.
 *
 * Both status writes go through core's mutators inside one transaction, so the
 * state machine is enforced here exactly as it is on the delivery path. A
 * MANUAL_FALLBACK order sitting in DELIVERING needs no first hop; a PAID one
 * does, which is why markDelivering() runs first (it is a no-op when the order
 * is already DELIVERING).
 */
export async function redeliverOrderAction(input: OrderRedeliverInput) {
  const session = requireRole(AdminRole.ADMIN)
  const data = orderRedeliverSchema.parse(input)

  const order = await prisma.order.findUnique({
    where: { id: data.orderId },
    include: { stockItem: true }
  })
  if (!order) {
    throw new Error(`Order not found: ${data.orderId}`)
  }
  if (!canRedeliverOrder(order)) {
    throw new Error(
      `Order ${data.orderId} cannot be re-delivered: status ${order.status} with no stored payload`
    )
  }

  // Non-null by canRedeliverOrder(), which required one of the two to exist.
  const payloadEnc = (order.deliveredPayloadEnc ?? order.stockItem?.payloadEnc) as string

  const updated = await prisma
    .$transaction(async (tx) => {
      await markDelivering(tx, data.orderId)
      return markDelivered(tx, data.orderId, payloadEnc)
    })
    .catch((err: unknown) => describeStateError(err, 're-delivered', data.orderId))

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
 * Refunds an order to the user's internal balance and marks it REFUNDED.
 *
 * The work is core's `refundOrder()` rather than a local transaction, because
 * the four things that make a refund correct are all easy to omit and were all
 * omitted here before: stock is released ONLY when still RESERVED (a credential
 * the buyer already received must never go back on sale), a capped promo's use
 * is returned, the state machine is consulted, and a zero-amount order is not
 * pushed through the ledger's positive-amount guard.
 *
 * Idempotent on the ledger key `refund:<orderId>` — shared with every other
 * refund path — so a double-clicked button credits the buyer exactly once.
 */
export async function refundOrderAction(input: OrderRefundInput) {
  const session = requireRole(AdminRole.ADMIN)
  const data = orderRefundSchema.parse(input)

  const order = await prisma.order.findUnique({ where: { id: data.orderId } })
  if (!order) {
    throw new Error(`Order not found: ${data.orderId}`)
  }
  if (!canRefundOrder(order.status)) {
    throw new Error(`Order ${data.orderId} is in status ${order.status} and cannot be refunded`)
  }

  const updatedOrder = await prisma
    .$transaction((tx) => refundOrder(tx, data.orderId, data.reason))
    .catch((err: unknown) => describeStateError(err, 'refunded', data.orderId))

  // Read after the commit: refundOrder() credits nothing for a zero-amount
  // order, so there is no ledger row to report and the balance is the only
  // number that is always true.
  const balanceAfterCents = await getBalance(prisma, order.userId)

  await writeAuditLog({
    actorId: session.adminId,
    action: 'order.refund',
    entity: 'Order',
    entityId: data.orderId,
    diff: { reason: data.reason, amountCents: order.amountCents }
  })

  revalidatePath(`/orders/${data.orderId}`)
  revalidatePath('/orders')
  return { updatedOrder, refundedCents: order.amountCents, balanceAfterCents }
}
