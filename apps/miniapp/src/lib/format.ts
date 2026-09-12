// `@tgshop/core/money` is the browser-safe subpath: pure integer arithmetic
// with no ioredis/node:crypto behind it, so importing it here keeps the single
// source of truth for money formatting instead of a copy that can drift.
import { centsToDisplay, applyPercentDiscount } from '@tgshop/core/money'

/** Formats integer cents as a localized currency string, e.g. 1299 -> "$12.99". */
export function formatCents(cents: number, currencySymbol = '$'): string {
  return `${currencySymbol}${centsToDisplay(cents)}`
}

/** Applies a plan discount with the same integer rounding as the API. */
export function discountedCents(priceCents: number, discountPercent: number): number {
  return applyPercentDiscount(priceCents, discountPercent)
}

/** Formats a date-ish input (ISO string or Date) using the given locale, short form. */
export function formatDate(input: string | Date, locale: 'ru' | 'en'): string {
  const date = typeof input === 'string' ? new Date(input) : input
  return new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(date)
}

/** Generates a client-side idempotency key for order/topup creation requests. */
export function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `idem_${Date.now()}_${Math.random().toString(36).slice(2)}`
}
