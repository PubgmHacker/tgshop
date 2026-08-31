import { usdCentsToStars } from '@tgshop/core'
import { env } from '../config/env.js'

/**
 * Converts a USD cents amount to whole Telegram Stars using the USD value of
 * one Star, expressed as a decimal string (for example, "0.013"). The
 * optional argument exists so the runtime Setting can override the deploy-time
 * fallback without introducing floating-point money arithmetic.
 */
export function amountCentsToStars(cents: number, rate = env.STARS_USD_RATE): number {
  if (!/^\d+(?:\.\d{1,6})?$/.test(rate) || !/[1-9]/.test(rate)) {
    throw new Error('STARS_USD_RATE must be a positive decimal string')
  }
  const [wholeStr, fracStr = ''] = rate.split('.')
  const decimals = fracStr.length
  const denominator = 10n ** BigInt(decimals)
  const rateNumerator = BigInt(`${wholeStr}${fracStr}`)
  // rate is USD per star; starsPerUsdCent = 1 / (rate * 100) = denominator / (rateNumerator * 100)
  const starsPerCentNumerator = denominator
  const starsPerCentDenominator = rateNumerator * 100n
  return usdCentsToStars(cents, starsPerCentNumerator, starsPerCentDenominator)
}

/**
 * Turns a per-plan Stars override into the total invoice amount. The override
 * is scaled by the final USD total, so quantity, plan discounts and promos do
 * not accidentally charge only one unit; Telegram still requires at least one
 * whole Star.
 */
export function planPriceToStars(
  priceStars: number | null | undefined,
  priceCents: number,
  qty: number,
  totalCents: number
): number | null {
  if (priceStars === null || priceStars === undefined) return null
  if (!Number.isInteger(priceStars) || priceStars <= 0) return null
  const baseCents = priceCents * qty
  if (!Number.isInteger(baseCents) || baseCents <= 0) return null
  return Math.max(1, Math.round((priceStars * totalCents) / baseCents))
}
