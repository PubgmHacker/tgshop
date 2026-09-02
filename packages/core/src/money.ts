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

// ─── USDT-TRC20 on a single receive address: "unique amount" tagging ─────────
//
// Every TRON payment lands on ONE static address (the owner's own wallet), so
// the transferred amount is the only thing that can say which invoice a
// transfer belongs to. Each open invoice therefore gets a unique sub-cent tag
// in the 3rd–4th decimals (0.0001 USDT steps): 29.0057 USDT means "$29.00,
// tag 57". The tag never moves the price by a whole cent, USDT keeps 6
// decimals so wallets send it exactly, and the worker matches an inbound
// transfer back to its invoice by the exact tagged amount.

/** USDT smallest units (6 decimals) per USD cent at the 1:1 peg. */
export const CENTS_TO_USDT6 = 10_000n
/** One tag step, 0.0001 USDT. */
export const TRON_TAG_UNIT_USDT6 = 100n
/** Tags run 1..99 so the tagged amount always stays strictly inside its cent. */
export const TRON_TAG_MAX = 99

/** Whole USD cents contained in a USDT6 amount (sub-cent dust floored away). */
export function usdt6ToUsdCents(amountUsdt6: bigint): number {
  if (amountUsdt6 < 0n) throw new RangeError(`usdt6ToUsdCents: amount must be non-negative, got ${amountUsdt6}`)
  return Number(amountUsdt6 / CENTS_TO_USDT6)
}

/** The exact USDT6 amount a customer must send for `cents` with sub-cent `tag`. */
export function tronTaggedAmountUsdt6(cents: number, tag: number): bigint {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new RangeError(`tronTaggedAmountUsdt6: cents must be a non-negative integer, got ${cents}`)
  }
  if (!Number.isInteger(tag) || tag < 1 || tag > TRON_TAG_MAX) {
    throw new RangeError(`tronTaggedAmountUsdt6: tag must be an integer in 1..${TRON_TAG_MAX}, got ${tag}`)
  }
  return BigInt(cents) * CENTS_TO_USDT6 + BigInt(tag) * TRON_TAG_UNIT_USDT6
}

/** Sub-cent tag carried by a USDT6 amount; 0 when the amount is a whole number of cents. */
export function tronTagOfAmountUsdt6(amountUsdt6: bigint): number {
  const abs = amountUsdt6 < 0n ? -amountUsdt6 : amountUsdt6
  return Number((abs % CENTS_TO_USDT6) / TRON_TAG_UNIT_USDT6)
}

/**
 * USDT6 -> human string with trailing zeros trimmed, never fewer than
 * `minDecimals` places: 29005700n -> "29.0057", 29000000n -> "29.00".
 * This is the string a customer types into a wallet, so it must be exact.
 */
export function usdt6ToDisplay(amountUsdt6: bigint | string, minDecimals = 2): string {
  const value = typeof amountUsdt6 === 'string' ? BigInt(amountUsdt6) : amountUsdt6
  const negative = value < 0n
  const abs = negative ? -value : value
  const whole = abs / USDT_SCALE
  let frac = (abs % USDT_SCALE).toString().padStart(USDT_DECIMALS, '0').replace(/0+$/, '')
  if (frac.length < minDecimals) frac = frac.padEnd(minDecimals, '0')
  return `${negative ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`
}
