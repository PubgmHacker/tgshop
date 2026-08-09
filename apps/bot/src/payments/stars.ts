import { usdCentsToStars } from '@tgshop/core'
import { env } from '../config/env.js'

/**
 * Converts a USD cents amount to whole Telegram Stars using STARS_USD_RATE
 * (USD value of 1 star, decimal string) expressed as an integer-safe ratio.
 */
export function amountCentsToStars(cents: number): number {
  const rate = env.STARS_USD_RATE // e.g. "0.013" USD per star
  const [wholeStr, fracStr = ''] = rate.split('.')
  const decimals = fracStr.length
  const denominator = 10n ** BigInt(decimals)
  const rateNumerator = BigInt(`${wholeStr}${fracStr}`) // USD-cent-equivalent numerator scaled by 10^decimals... see below
  // rate is USD per star; starsPerUsdCent = 1 / (rate * 100) = denominator / (rateNumerator * 100)
  const starsPerCentNumerator = denominator
  const starsPerCentDenominator = rateNumerator * 100n
  return usdCentsToStars(cents, starsPerCentNumerator, starsPerCentDenominator)
}
