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
