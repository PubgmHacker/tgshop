/**
 * Formats a bigint amount with `decimals` implied decimal places into a
 * human display string, e.g. formatUnits(1_500000n, 6) -> "1.5"
 */
export function formatUnits(amount: bigint, decimals: number): string {
  const negative = amount < 0n
  const abs = negative ? -amount : amount
  const scale = 10n ** BigInt(decimals)
  const whole = abs / scale
  const frac = abs % scale
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '')
  const sign = negative ? '-' : ''
  return fracStr.length > 0 ? `${sign}${whole}.${fracStr}` : `${sign}${whole}`
}

export function formatUsd(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}$${(abs / 100).toFixed(2)}`
}

export function formatUsdt(units6: bigint): string {
  return `${formatUnits(units6, 6)} USDT`
}

export function formatStars(stars: number): string {
  return `${stars} ⭐️`
}
