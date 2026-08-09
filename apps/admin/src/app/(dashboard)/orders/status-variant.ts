import { OrderStatus, PaymentStatus } from '@tgshop/db'

type BadgeVariant = 'default' | 'success' | 'warning' | 'destructive' | 'secondary'

/** Shared status → badge colour mapping so the list and detail views never disagree. */
export function orderStatusVariant(status: OrderStatus): BadgeVariant {
  switch (status) {
    case OrderStatus.DELIVERED:
      return 'success'
    case OrderStatus.PAID:
    case OrderStatus.DELIVERING:
      return 'default'
    case OrderStatus.PENDING:
      return 'warning'
    case OrderStatus.FAILED:
      return 'destructive'
    case OrderStatus.REFUNDED:
    case OrderStatus.EXPIRED:
      return 'secondary'
    default:
      return 'secondary'
  }
}

export function paymentStatusVariant(status: PaymentStatus): BadgeVariant {
  switch (status) {
    case PaymentStatus.PAID:
      return 'success'
    case PaymentStatus.PENDING:
    case PaymentStatus.CONFIRMING:
      return 'warning'
    case PaymentStatus.UNDERPAID:
    case PaymentStatus.FAILED:
      return 'destructive'
    case PaymentStatus.EXPIRED:
      return 'secondary'
    default:
      return 'secondary'
  }
}
