import { describe, it, expect } from 'vitest'
import type { Plan, Promo } from '@tgshop/db'
import { PromoType } from '@tgshop/db'
import { computeOrderTotal, validatePromo } from '../pricing.js'
import { PromoInvalidError } from '../errors.js'

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan_1',
    productId: 'prod_1',
    title: '1 month',
    durationDays: 30,
    priceCents: 999,
    priceStars: 700,
    discountPercent: 0,
    lowStockThreshold: 3,
    isActive: true,
    sortOrder: 0,
    ...overrides
  }
}

function makePromo(overrides: Partial<Promo> = {}): Promo {
  return {
    id: 'promo_1',
    code: 'SAVE10',
    type: PromoType.PERCENT,
    value: 10,
    maxUses: null,
    usedCount: 0,
    expiresAt: null,
    planId: null,
    isActive: true,
    ...overrides
  }
}

describe('computeOrderTotal', () => {
  it('multiplies unit price by qty with no discounts', () => {
    const breakdown = computeOrderTotal(makePlan(), 3)
    expect(breakdown).toMatchObject({
      planId: 'plan_1',
      qty: 3,
      unitPriceCents: 999,
      subtotalCents: 2997,
      promoCode: null,
      promoDiscountCents: 0,
      totalCents: 2997
    })
  })

  it('applies the plan discount to the unit price before multiplying', () => {
    // 999 - round(99.9) = 999 - 100 = 899 per unit
    const breakdown = computeOrderTotal(makePlan({ discountPercent: 10 }), 2)
    expect(breakdown.unitPriceCents).toBe(899)
    expect(breakdown.subtotalCents).toBe(1798)
    expect(breakdown.totalCents).toBe(1798)
  })

  it('applies a percent promo on top of the plan discount', () => {
    const breakdown = computeOrderTotal(makePlan({ discountPercent: 10 }), 2, makePromo({ value: 50 }))
    expect(breakdown.subtotalCents).toBe(1798)
    expect(breakdown.promoDiscountCents).toBe(899)
    expect(breakdown.totalCents).toBe(899)
    expect(breakdown.promoCode).toBe('SAVE10')
  })

  it('applies a fixed promo in cents', () => {
    const breakdown = computeOrderTotal(
      makePlan({ priceCents: 1000 }),
      1,
      makePromo({ type: PromoType.FIXED, value: 250 })
    )
    expect(breakdown.promoDiscountCents).toBe(250)
    expect(breakdown.totalCents).toBe(750)
  })

  it('never lets a fixed promo push the total below zero', () => {
    const breakdown = computeOrderTotal(
      makePlan({ priceCents: 500 }),
      1,
      makePromo({ type: PromoType.FIXED, value: 100000 })
    )
    expect(breakdown.promoDiscountCents).toBe(500)
    expect(breakdown.totalCents).toBe(0)
  })

  it('rejects a non-positive or fractional qty', () => {
    expect(() => computeOrderTotal(makePlan(), 0)).toThrow(RangeError)
    expect(() => computeOrderTotal(makePlan(), -2)).toThrow(RangeError)
    expect(() => computeOrderTotal(makePlan(), 1.5)).toThrow(RangeError)
  })
})

describe('promo validation', () => {
  const plan = makePlan()

  it('accepts a clean promo', () => {
    expect(() => validatePromo(makePromo(), plan)).not.toThrow()
  })

  it('rejects an inactive promo', () => {
    expect(() => validatePromo(makePromo({ isActive: false }), plan)).toThrow(PromoInvalidError)
  })

  it('rejects an expired promo', () => {
    const promo = makePromo({ expiresAt: new Date('2020-01-01T00:00:00Z') })
    expect(() => validatePromo(promo, plan, new Date('2026-01-01T00:00:00Z'))).toThrow(PromoInvalidError)
  })

  it('accepts a promo that has not expired yet', () => {
    const promo = makePromo({ expiresAt: new Date('2026-06-01T00:00:00Z') })
    expect(() => validatePromo(promo, plan, new Date('2026-01-01T00:00:00Z'))).not.toThrow()
  })

  it('rejects an exhausted promo', () => {
    expect(() => validatePromo(makePromo({ maxUses: 5, usedCount: 5 }), plan)).toThrow(PromoInvalidError)
    expect(() => validatePromo(makePromo({ maxUses: 5, usedCount: 4 }), plan)).not.toThrow()
  })

  it('rejects a promo bound to a different plan', () => {
    expect(() => validatePromo(makePromo({ planId: 'plan_other' }), plan)).toThrow(PromoInvalidError)
    expect(() => validatePromo(makePromo({ planId: 'plan_1' }), plan)).not.toThrow()
  })

  it('rejects out-of-range promo values', () => {
    expect(() => validatePromo(makePromo({ value: 101 }), plan)).toThrow(PromoInvalidError)
    expect(() => validatePromo(makePromo({ type: PromoType.FIXED, value: -1 }), plan)).toThrow(
      PromoInvalidError
    )
  })

  it('surfaces promo failures through computeOrderTotal', () => {
    expect(() => computeOrderTotal(plan, 1, makePromo({ isActive: false }))).toThrow(PromoInvalidError)
  })
})
