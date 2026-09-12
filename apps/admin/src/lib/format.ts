import { centsToDisplay } from '@tgshop/core/money'

// ─────────────────────────────────────────────────────────────────────────────
// Display helpers shared by server and client components.
//
// Everything here is deterministic and locale-free on purpose: the same value
// must render identically on the server and during client hydration, so
// toLocaleString()/timezone-dependent formatting is deliberately avoided. All
// timestamps are shown in UTC.
// ─────────────────────────────────────────────────────────────────────────────

/** cents -> "$12.99" / "-$12.99". Non-integers render as an em dash instead of throwing. */
export function formatCents(cents: number): string {
  if (!Number.isInteger(cents)) return '—'
  return cents < 0 ? `-$${centsToDisplay(-cents)}` : `$${centsToDisplay(cents)}`
}

/** Date -> "2026-08-08 14:30" (UTC). */
export function formatDateTime(value: Date | string | null | undefined): string {
  const date = toDate(value)
  if (!date) return '—'
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)}`
}

/** Date -> "2026-08-08" (UTC). */
export function formatDate(value: Date | string | null | undefined): string {
  const date = toDate(value)
  if (!date) return '—'
  return date.toISOString().slice(0, 10)
}

/** Date -> "2026-08-08T14:30", the value shape an `<input type="datetime-local">` expects. */
export function toDateTimeLocalValue(value: Date | string | null | undefined): string {
  const date = toDate(value)
  if (!date) return ''
  return date.toISOString().slice(0, 16)
}

/** Parses an `<input type="datetime-local">` value back to a Date, treating it as UTC. */
export function fromDateTimeLocalValue(value: string): Date | null {
  if (!value) return null
  const date = new Date(`${value}:00.000Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Pretty-prints a JSON value for a <pre> block. */
export function formatJson(value: unknown): string {
  if (value === null || value === undefined) return '—'
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const LABELS: Record<string, string> = {
  PENDING: 'Ожидает оплаты', PAID: 'Оплачен', DELIVERING: 'Выдаётся', DELIVERED: 'Выдан',
  FAILED: 'Ошибка', REFUNDED: 'Возврат', EXPIRED: 'Истёк',
  BALANCE: 'Баланс', CRYPTOBOT: 'CryptoBot', STARS: 'Telegram Stars', TRON_TRC20: 'USDT · TRC20',
  STOCK_POOL: 'Из наличия', UNIQUE_CODE: 'Код активации', EXTERNAL_API: 'Через поставщика', MANUAL_FALLBACK: 'Вручную',
  AVAILABLE: 'Доступно', RESERVED: 'В резерве', SOLD: 'Продано',
  PERCENT: 'Процент', FIXED: 'Сумма',
  DRAFT: 'Черновик', SCHEDULED: 'Запланирована', QUEUED: 'В очереди', SENDING: 'Отправляется', SENT: 'Отправлена', CANCELLED: 'Отменена',
  TOPUP: 'Пополнение', PURCHASE: 'Покупка', REFUND: 'Возврат', REFERRAL: 'Реферальное начисление', ADJUSTMENT: 'Корректировка'
}

export function formatEnum(value: string): string { return LABELS[value] ?? value }
