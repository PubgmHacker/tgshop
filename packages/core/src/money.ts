// ─────────────────────────────────────────────────────────────────────────────
// Integer money helpers. Money is ALWAYS an integer in the smallest unit:
//   USD    -> cents (Int)
//   USDT   -> 6 decimals (BigInt)
//   Stars  -> whole Int
// No floating point is used anywhere in these calculations.
// ─────────────────────────────────────────────────────────────────────────────

export const USDT_DECIMALS = 6
const USDT_SCALE = 10n ** BigInt(USDT_DECIMALS)

/** cents (Int) -> human display string, e.g. 1299 -> "12.99" */
export function centsToDisplay(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new RangeError(`centsToDisplay expects an integer, got ${cents}`)
  }
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const whole = Math.trunc(abs / 100)
  const frac = abs % 100
  return `${sign}${whole}.${frac.toString().padStart(2, '0')}`
}

/** human display string, e.g. "12.99" -> 1299 cents. Rejects anything but up to 2 decimal places. */
export function displayToCents(display: string): number {
  const trimmed = display.trim()
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed)
  if (!match) {
    throw new RangeError(`displayToCents: invalid money string "${display}"`)
  }
  const [, signStr, wholeStr, fracStr] = match
  const sign = signStr === '-' ? -1 : 1
  const whole = Number.parseInt(wholeStr ?? '0', 10)
  const frac = (fracStr ?? '').padEnd(2, '0')
  const fracNum = Number.parseInt(frac, 10)
  return sign * (whole * 100 + fracNum)
}

/**
 * Converts USD cents to USDT smallest units (6 decimals), returned as a BigInt.
 * usdtPerUsd is expressed as a BigInt-scaled rate to avoid floats: rateNumerator/rateDenominator.
 * Defaults to a 1:1 peg (rateNumerator=1, rateDenominator=1).
 */
export function usdCentsToUsdt6(
  cents: number,
  rateNumerator: bigint = 1n,
  rateDenominator: bigint = 1n
): bigint {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new RangeError(`usdCentsToUsdt6 expects a non-negative integer cents value, got ${cents}`)
  }
  if (rateDenominator <= 0n) {
    throw new RangeError('rateDenominator must be positive')
  }
  const centsBig = BigInt(cents)
  // cents are 1/100 USD; USDT6 is 1/1_000_000 USDT. Scale factor from cents -> usdt6 is 10_000.
  const CENTS_TO_USDT6_SCALE = USDT_SCALE / 100n // 10_000
  return (centsBig * CENTS_TO_USDT6_SCALE * rateNumerator) / rateDenominator
}

/**
 * Converts USD cents to Telegram Stars using an integer-safe rate expressed as
 * starsPerUsdCent = rateNumerator/rateDenominator (e.g. rate 0.7 stars per cent
 * would be numerator=7, denominator=10). Rounds half up. Result is always >= 0.
 */
export function usdCentsToStars(
  cents: number,
  rateNumerator: bigint = 1n,
  rateDenominator: bigint = 1n
): number {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new RangeError(`usdCentsToStars expects a non-negative integer cents value, got ${cents}`)
  }
  if (rateDenominator <= 0n) {
    throw new RangeError('rateDenominator must be positive')
  }
  const centsBig = BigInt(cents)
  const numerator = centsBig * rateNumerator
  const stars = roundHalfUpDiv(numerator, rateDenominator)
  return Number(stars)
}

/**
 * Half-up rounding division for BigInt, e.g. roundHalfUpDiv(5n, 2n) === 3n.
 * Only defined for non-negative numerator and positive denominator.
 */
function roundHalfUpDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new RangeError('denominator must be positive')
  }
  // floor(n/d + 1/2) written with integers only: floor((2n + d) / 2d).
  // Truncating `(2n)/d` first loses the exact-half case (5/2 would land on 2),
  // which is why the halving happens after the +d, not before.
  return (numerator * 2n + denominator) / (denominator * 2n)
}

/**
 * Applies a percent discount (0-100, integer) to a cents amount.
 * Rounding rule: round half up on the resulting cents value (documented banker
 * alternative rejected — half-up is simpler to reason about for money owed to
 * the shop and matches typical POS rounding expectations).
 *
 * Example: 999 cents at 10% off -> discount 99.9 -> rounds to 100 -> 899 cents.
 */
export function applyPercentDiscount(cents: number, percent: number): number {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new RangeError(`applyPercentDiscount expects a non-negative integer cents value, got ${cents}`)
  }
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    throw new RangeError(`applyPercentDiscount expects an integer percent in [0,100], got ${percent}`)
  }
  const discount = roundHalfUpDivInt(cents * percent, 100)
  return cents - discount
}

/** Applies a fixed-cents discount, clamped at 0 (never negative total). */
export function applyFixedDiscount(cents: number, discountCents: number): number {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new RangeError(`applyFixedDiscount expects a non-negative integer cents value, got ${cents}`)
  }
  if (!Number.isInteger(discountCents) || discountCents < 0) {
    throw new RangeError(`applyFixedDiscount expects a non-negative integer discountCents, got ${discountCents}`)
  }
  return Math.max(0, cents - discountCents)
}

/** Half-up rounding division for regular (safe-range) integers. */
function roundHalfUpDivInt(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    throw new RangeError('denominator must be positive')
  }
  return Math.floor(numerator / denominator + 0.5)
}

/** Multiplies a per-unit cents price by an integer quantity, guarding overflow-safe integers. */
export function multiplyCents(unitCents: number, qty: number): number {
  if (!Number.isInteger(unitCents) || unitCents < 0) {
    throw new RangeError(`multiplyCents expects a non-negative integer unitCents, got ${unitCents}`)
  }
  if (!Number.isInteger(qty) || qty < 1) {
    throw new RangeError(`multiplyCents expects a positive integer qty, got ${qty}`)
  }
  const total = unitCents * qty
  if (!Number.isSafeInteger(total)) {
    throw new RangeError('multiplyCents result exceeds safe integer range')
  }
  return total
}
