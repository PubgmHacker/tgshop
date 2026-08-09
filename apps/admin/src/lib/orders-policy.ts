import { OrderStatus, type Order, type StockItem } from '@tgshop/db'
import { ALLOWED_TRANSITIONS } from '@tgshop/core'

// ─────────────────────────────────────────────────────────────────────────────
// What an admin is allowed to do to an order.
//
// This lives outside lib/actions/orders.ts because that file is a `'use server'`
// module: every export there must be an async server action, so it cannot also
// export the predicates the page needs to enable or disable a button. Keeping
// them here means the page and the action decide from the SAME rule instead of
// drifting into a UI that offers an operation the server then rejects.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Statuses a re-delivery may start from.
 *
 * FAILED is deliberately absent. A failed delivery has already been auto-
 * refunded (`delivery-failed-refund:<orderId>`), so re-delivering it would hand
 * over the goods on top of money already returned. The admin's route for a
 * customer who paid and got nothing is to take payment again, not to re-deliver.
 *
 * Widened to `readonly OrderStatus[]` on purpose: a bare array literal narrows
 * to its own members and `.includes(order.status)` would then be a type error
 * rather than the runtime check we want.
 */
export const REDELIVERABLE_STATUSES: readonly OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.DELIVERING,
  OrderStatus.DELIVERED
]

/** Anything that can supply the ciphertext a re-delivery re-attaches. */
type RedeliverySource = Pick<Order, 'status' | 'deliveredPayloadEnc'> & {
  stockItem: Pick<StockItem, 'payloadEnc'> | null
}

/**
 * True when there is both a legal state to re-deliver from and a payload to
 * re-deliver. The payload may live on the order (UNIQUE_CODE plans mint their
 * code from a template and never touch the stock pool) or on the reserved stock
 * item, so checking only for a stock item would wrongly disable the button for
 * every template-minted order.
 */
export function canRedeliverOrder(order: RedeliverySource): boolean {
  if (!REDELIVERABLE_STATUSES.includes(order.status)) return false
  return order.deliveredPayloadEnc !== null || order.stockItem?.payloadEnc != null
}

/**
 * True when `status -> REFUNDED` is an edge in core's state machine — the same
 * check `refundOrder()` performs, so the button is disabled exactly when the
 * server would refuse. Excludes PENDING (never paid) and the terminal states.
 */
export function canRefundOrder(status: OrderStatus): boolean {
  return ALLOWED_TRANSITIONS[status].includes(OrderStatus.REFUNDED)
}
