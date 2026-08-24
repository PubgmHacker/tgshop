'use server'

import { revalidatePath } from 'next/cache'
import { prisma, AdminRole, OrderStatus, type Prisma } from '@tgshop/db'
import {
  createSubscriptionForOrder,
  deliverManualOrder,
  getBalance,
  markDelivered,
  markDelivering,
  refundOrder,
  OrderStateError
} from '@tgshop/core'
import { requireRole } from '../rbac'
import { writeAuditLog } from '../audit'
import { emitEvent } from '../events'
import { getEnv } from '../env'
import { canManualDeliverOrder, canRedeliverOrder, canRefundOrder } from '../orders-policy'
import {
  orderFilterSchema,
  orderManualDeliverSchema,
  orderRedeliverSchema,
  orderRefundSchema,
  type OrderFilterInput,
  type OrderManualDeliverInput,
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
      const delivered = await markDelivered(tx, data.orderId, payloadEnc)
      // A PAID order crossing into DELIVERED here would otherwise skip the
      // Subscription row fulfillOrder() creates on the normal path (idempotent
      // on Subscription.orderId, so a re-send of an already-DELIVERED order
      // creates nothing new — it only repairs a missing row).
      await createSubscriptionForOrder(tx, data.orderId)
      return delivered
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

function escapeHtml(input: string): string {
  return input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Best-effort Telegram push to the buyer with the freshly issued payload,
 * spoiler-wrapped exactly like the bot's own delivery message. Uses the raw
 * Bot API over fetch — the admin app has no grammY instance and must not gain
 * one for a single call. Returns false (never throws) when BOT_TOKEN is not
 * configured or Telegram rejects the send; the delivery itself already
 * committed, and the buyer can still read the payload from their order list.
 */
async function notifyBuyerDelivered(
  tgId: bigint,
  languageCode: string | null,
  orderId: string,
  payload: string
): Promise<boolean> {
  const token = getEnv().BOT_TOKEN
  if (!token) return false

  const ru = languageCode?.toLowerCase().startsWith('ru') ?? false
  const caption = ru ? `✅ Ваш заказ ${orderId} выдан:` : `✅ Your order ${orderId} has been delivered:`
  const footer = ru
    ? '\n\nНажмите на скрытый текст, чтобы открыть его.'
    : '\n\nTap the hidden text to reveal it.'
  const text = `${caption}\n\n<span class="tg-spoiler"><code>${escapeHtml(payload)}</code></span>${footer}`

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: tgId.toString(), text, parse_mode: 'HTML' })
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Finishes a MANUAL_FALLBACK order by hand: encrypts the operator-typed
 * payload into the order, marks it DELIVERED and creates the Subscription row
 * (all in core's deliverManualOrder, one transaction), then pushes the payload
 * to the buyer over Telegram when a BOT_TOKEN is configured.
 *
 * The payload itself is deliberately kept OUT of the audit log — the audit
 * table is readable by every admin role, while delivered credentials live only
 * encrypted on the order row.
 */
export async function deliverOrderManuallyAction(input: OrderManualDeliverInput) {
  const session = requireRole(AdminRole.ADMIN)
  const data = orderManualDeliverSchema.parse(input)

  const order = await prisma.order.findUnique({
    where: { id: data.orderId },
    include: { stockItem: true, user: true }
  })
  if (!order) {
    throw new Error(`Order not found: ${data.orderId}`)
  }
  if (!canManualDeliverOrder(order)) {
    throw new Error(
      `Order ${data.orderId} cannot be delivered manually: status ${order.status}` +
        (order.deliveredPayloadEnc !== null || order.stockItem?.payloadEnc != null
          ? ' and it already has a stored payload — use re-delivery instead'
          : '')
    )
  }

  const updated = await deliverManualOrder(prisma, data.orderId, data.payload).catch(
    (err: unknown) => describeStateError(err, 'delivered manually', data.orderId)
  )

  await writeAuditLog({
    actorId: session.adminId,
    action: 'order.manual_deliver',
    entity: 'Order',
    entityId: data.orderId,
    diff: { payloadLength: data.payload.trim().length, customerEmail: order.customerEmail }
  })

  // After the commit, never inside it (lib/events.ts contract).
  await emitEvent('order.delivered', {
    orderId: data.orderId,
    userId: order.userId,
    planId: order.planId,
    deliveredAt: (updated.deliveredAt ?? new Date()).toISOString()
  })

  const buyerNotified = await notifyBuyerDelivered(
    order.user.tgId,
    order.user.languageCode,
    data.orderId,
    data.payload.trim()
  )

  revalidatePath(`/orders/${data.orderId}`)
  revalidatePath('/orders')
  return { order: updated, buyerNotified }
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

  // After the commit, never inside it (lib/events.ts contract).
  await emitEvent('order.refunded', {
    orderId: data.orderId,
    userId: order.userId,
    planId: order.planId,
    refundedCents: order.amountCents,
    reason: data.reason,
    refundedBy: 'admin'
  })

  revalidatePath(`/orders/${data.orderId}`)
  revalidatePath('/orders')
  return { updatedOrder, refundedCents: order.amountCents, balanceAfterCents }
}
