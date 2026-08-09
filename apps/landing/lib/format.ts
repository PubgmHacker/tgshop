import type { Locale } from './i18n';

/**
 * Formats an integer cents amount as a display price string.
 * Money is always represented as integer cents (USD) per platform convention;
 * this is presentation-only and never used for calculations.
 */
export function formatPriceCents(cents: number, locale: Locale): string {
  const amount = cents / 100;
  const currency = locale === 'ru' ? 'KZT' : 'USD';

  try {
    return new Intl.NumberFormat(locale === 'ru' ? 'ru-RU' : 'en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)}`;
  }
}
