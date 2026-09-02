import { describe, it, expect } from 'vitest'
import {
  TRON_TAG_MAX,
  USDT_DECIMALS,
  applyFixedDiscount,
  applyPercentDiscount,
  centsToDisplay,
  displayToCents,
  multiplyCents,
  tronTagOfAmountUsdt6,
  tronTaggedAmountUsdt6,
  usdCentsToStars,
  usdCentsToUsdt6,
  usdt6ToDisplay,
  usdt6ToUsdCents
} from '../money.js'

describe('centsToDisplay / displayToCents', () => {
  it('formats cents with two decimals', () => {
    expect(centsToDisplay(0)).toBe('0.00')
    expect(centsToDisplay(5)).toBe('0.05')
    expect(centsToDisplay(50)).toBe('0.50')
    expect(centsToDisplay(1299)).toBe('12.99')
    expect(centsToDisplay(100000)).toBe('1000.00')
  })

  it('keeps the sign on negative amounts', () => {
    expect(centsToDisplay(-1)).toBe('-0.01')
    expect(centsToDisplay(-1299)).toBe('-12.99')
  })

  it('rejects non-integers', () => {
    expect(() => centsToDisplay(12.5)).toThrow(RangeError)
    expect(() => centsToDisplay(Number.NaN)).toThrow(RangeError)
  })

  it('parses display strings back to cents', () => {
    expect(displayToCents('0')).toBe(0)
    expect(displayToCents('0.05')).toBe(5)
    expect(displayToCents('12.9')).toBe(1290)
    expect(displayToCents('12.99')).toBe(1299)
    expect(displayToCents(' 7.01 ')).toBe(701)
    expect(displayToCents('-12.99')).toBe(-1299)
  })

  it('rejects malformed money strings', () => {
    for (const bad of ['', 'abc', '1.234', '1.', '.5', '1,99', '1e3', '--1']) {
      expect(() => displayToCents(bad), bad).toThrow(RangeError)
    }
  })

  it('round-trips cents -> display -> cents', () => {
    for (const cents of [0, 1, 9, 10, 99, 100, 501, 1299, 99999, 123456789]) {
      expect(displayToCents(centsToDisplay(cents))).toBe(cents)
    }
  })
})

describe('usdCentsToUsdt6', () => {
  it('scales cents to 6 decimals at a 1:1 peg', () => {
    expect(USDT_DECIMALS).toBe(6)
    expect(usdCentsToUsdt6(0)).toBe(0n)
    expect(usdCentsToUsdt6(1)).toBe(10_000n)
    expect(usdCentsToUsdt6(100)).toBe(1_000_000n)
    expect(usdCentsToUsdt6(1299)).toBe(12_990_000n)
  })

  it('applies an integer rate without floats', () => {
    // 1 USD = 0.99 USDT -> numerator 99, denominator 100
    expect(usdCentsToUsdt6(100, 99n, 100n)).toBe(990_000n)
  })

  it('rejects negatives, non-integers and a zero denominator', () => {
    expect(() => usdCentsToUsdt6(-1)).toThrow(RangeError)
    expect(() => usdCentsToUsdt6(1.5)).toThrow(RangeError)
    expect(() => usdCentsToUsdt6(100, 1n, 0n)).toThrow(RangeError)
  })
})

describe('usdCentsToStars', () => {
  it('converts at a 1:1 rate', () => {
    expect(usdCentsToStars(0)).toBe(0)
    expect(usdCentsToStars(1299)).toBe(1299)
  })

  it('rounds half up', () => {
    // 0.5 stars per cent: 5 cents -> 2.5 -> 3
    expect(usdCentsToStars(5, 1n, 2n)).toBe(3)
    expect(usdCentsToStars(4, 1n, 2n)).toBe(2)
    // 0.7 stars per cent: 100 cents -> 70
    expect(usdCentsToStars(100, 7n, 10n)).toBe(70)
    // 1 cent at 0.7 -> 0.7 -> 1
    expect(usdCentsToStars(1, 7n, 10n)).toBe(1)
    // 1 cent at 0.4 -> 0.4 -> 0
    expect(usdCentsToStars(1, 4n, 10n)).toBe(0)
  })

  it('rejects negatives, non-integers and a zero denominator', () => {
    expect(() => usdCentsToStars(-5)).toThrow(RangeError)
    expect(() => usdCentsToStars(5.5)).toThrow(RangeError)
    expect(() => usdCentsToStars(5, 1n, 0n)).toThrow(RangeError)
  })
})

describe('discounts', () => {
  it('rounds the percent discount half up', () => {
    // 999 * 10% = 99.9 -> discount 100 -> 899
    expect(applyPercentDiscount(999, 10)).toBe(899)
    // 105 * 50% = 52.5 -> discount 53 -> 52
    expect(applyPercentDiscount(105, 50)).toBe(52)
    expect(applyPercentDiscount(1000, 0)).toBe(1000)
    expect(applyPercentDiscount(1000, 100)).toBe(0)
  })

  it('rejects out-of-range percents and non-integer money', () => {
    expect(() => applyPercentDiscount(100, 101)).toThrow(RangeError)
    expect(() => applyPercentDiscount(100, -1)).toThrow(RangeError)
    expect(() => applyPercentDiscount(100, 10.5)).toThrow(RangeError)
    expect(() => applyPercentDiscount(100.5, 10)).toThrow(RangeError)
    expect(() => applyPercentDiscount(-100, 10)).toThrow(RangeError)
  })

  it('clamps a fixed discount at zero, never negative', () => {
    expect(applyFixedDiscount(500, 200)).toBe(300)
    expect(applyFixedDiscount(500, 500)).toBe(0)
    expect(applyFixedDiscount(500, 900)).toBe(0)
  })

  it('rejects a negative fixed discount', () => {
    expect(() => applyFixedDiscount(500, -1)).toThrow(RangeError)
  })
})

describe('multiplyCents', () => {
  it('multiplies unit price by quantity', () => {
    expect(multiplyCents(499, 1)).toBe(499)
    expect(multiplyCents(499, 3)).toBe(1497)
  })

  it('rejects a non-positive or fractional quantity', () => {
    expect(() => multiplyCents(499, 0)).toThrow(RangeError)
    expect(() => multiplyCents(499, -1)).toThrow(RangeError)
    expect(() => multiplyCents(499, 1.5)).toThrow(RangeError)
    expect(() => multiplyCents(4.99, 2)).toThrow(RangeError)
  })

  it('guards against exceeding the safe integer range', () => {
    expect(() => multiplyCents(Number.MAX_SAFE_INTEGER, 2)).toThrow(RangeError)
  })
})

describe('TRON unique-amount tagging', () => {
  it('builds the exact tagged amount and reads the tag back', () => {
    const amount = tronTaggedAmountUsdt6(2900, 57)
    expect(amount).toBe(29_005_700n)
    expect(tronTagOfAmountUsdt6(amount)).toBe(57)
    expect(usdt6ToUsdCents(amount)).toBe(2900)
    expect(usdt6ToDisplay(amount)).toBe('29.0057')
  })

  it('keeps every tag strictly inside its own cent', () => {
    for (let tag = 1; tag <= TRON_TAG_MAX; tag += 1) {
      const amount = tronTaggedAmountUsdt6(1, tag)
      expect(usdt6ToUsdCents(amount)).toBe(1)
      expect(tronTagOfAmountUsdt6(amount)).toBe(tag)
    }
  })

  it('rejects tags outside 1..99 and negative cents', () => {
    expect(() => tronTaggedAmountUsdt6(100, 0)).toThrow(RangeError)
    expect(() => tronTaggedAmountUsdt6(100, 100)).toThrow(RangeError)
    expect(() => tronTaggedAmountUsdt6(-1, 5)).toThrow(RangeError)
    expect(() => tronTaggedAmountUsdt6(1.5, 5)).toThrow(RangeError)
  })

  it('reports tag 0 for untagged (whole-cent) amounts', () => {
    expect(tronTagOfAmountUsdt6(29_000_000n)).toBe(0)
    expect(tronTagOfAmountUsdt6(0n)).toBe(0)
  })

  it('formats display amounts exactly with at least two decimals', () => {
    expect(usdt6ToDisplay(29_000_000n)).toBe('29.00')
    expect(usdt6ToDisplay('29005700')).toBe('29.0057')
    expect(usdt6ToDisplay(100n)).toBe('0.0001')
    expect(usdt6ToDisplay(1_234_567n)).toBe('1.234567')
    expect(usdt6ToDisplay(0n)).toBe('0.00')
  })
})
