import type { Locale } from './i18n'

/**
 * Formats an integer cents amount as a display price string.
 * Money is always represented as integer cents (USD) per platform convention;
 * this is presentation-only and never used for calculations.
 */
export function formatPriceCents(cents: number, locale: Locale): string {
  // The checkout and database are denominated in USD cents in every locale.
  // Keep the symbol and decimal convention aligned with the Mini App instead
  // of silently changing Russian visitors to KZT.
  const amount = cents / 100
  const formatted = new Intl.NumberFormat(locale === 'ru' ? 'ru-RU' : 'en-US', {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  }).format(amount)
  return `$${formatted}`
}

/** Price covers this whole duration; one-off codes do not imply lifetime access. */
export function formatPlanDuration(days: number | null, locale: Locale): string {
  if (days === null) return locale === 'ru' ? 'разовая покупка' : 'one-time purchase'
  if (locale === 'en') return `for ${days} ${days === 1 ? 'day' : 'days'}`
  const unit = new Intl.PluralRules('ru').select(days)
  return `за ${days} ${unit === 'one' ? 'день' : unit === 'few' ? 'дня' : 'дней'}`
}
