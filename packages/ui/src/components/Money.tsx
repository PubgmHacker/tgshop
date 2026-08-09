import type { HTMLAttributes } from 'react'
import clsx from 'clsx'

export type MoneyCurrency = 'USD' | 'USDT' | 'STARS'

export interface MoneyProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** USD cents (Int) when currency=USD; USDT smallest units (6 decimals) as bigint|string when currency=USDT; whole Stars (Int) when currency=STARS. */
  amount: number | bigint | string
  currency: MoneyCurrency
  /** Show the currency suffix/symbol next to the number. Defaults to true. */
  showSuffix?: boolean
}

const USDT_DECIMALS = 6

function formatUsdCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const whole = Math.trunc(abs / 100)
  const frac = abs % 100
  return `${sign}${whole.toLocaleString('en-US')}.${frac.toString().padStart(2, '0')}`
}

function formatUsdt6(units: bigint): string {
  const sign = units < 0n ? '-' : ''
  const abs = units < 0n ? -units : units
  const scale = 10n ** BigInt(USDT_DECIMALS)
  const whole = abs / scale
  const frac = abs % scale
  return `${sign}${whole.toLocaleString('en-US')}.${frac.toString().padStart(USDT_DECIMALS, '0')}`
}

/**
 * Renders an integer money amount (never a float) with correct decimal
 * placement per currency. USD cents -> "$12.99", USDT6 -> "12.000000 USDT",
 * STARS -> "150 ⭐". Mirrors the integer-money conventions from @tgshop/core.
 */
export function Money({ amount, currency, showSuffix = true, className, ...rest }: MoneyProps) {
  let display: string
  let suffix: string

  if (currency === 'USD') {
    const cents = typeof amount === 'bigint' ? Number(amount) : Number(amount)
    display = formatUsdCents(cents)
    suffix = '$'
    return (
      <span className={clsx('font-medium tabular-nums', className)} {...rest}>
        {showSuffix ? `${suffix}${display}` : display}
      </span>
    )
  }

  if (currency === 'USDT') {
    const units = typeof amount === 'bigint' ? amount : BigInt(amount)
    display = formatUsdt6(units)
    suffix = 'USDT'
  } else {
    const stars = typeof amount === 'bigint' ? amount.toString() : String(amount)
    display = Number(stars).toLocaleString('en-US')
    suffix = '⭐'
  }

  return (
    <span className={clsx('font-medium tabular-nums', className)} {...rest}>
      {display}
      {showSuffix ? ` ${suffix}` : ''}
    </span>
  )
}
