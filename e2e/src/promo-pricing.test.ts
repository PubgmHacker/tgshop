import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PaymentProvider, PromoType, type Promo } from '@tgshop/db'
import { PromoInvalidError, computeOrderTotal, createOrder } from '@tgshop/core'
import { createFixture, prisma, requireDefined, type TestFixture } from './setup.js'

// ─────────────────────────────────────────────────────────────────────────────
// Promo pricing, persisted.
//
// Money is integer cents everywhere; the interesting part is the rounding
// boundary. 1999¢ × 2 = 3998¢, and 25% of 3998 is exactly 999.5¢ — half-up
// rounding must make that a 1000¢ discount and a 2998¢ total, with the same
// integer landing in Order.amountCents as computeOrderTotal returned.
// ─────────────────────────────────────────────────────────────────────────────

const PRICE_CENTS = 1_999
const QTY = 2
const PERCENT_OFF = 25
const EXPECTED_SUBTOTAL = 3_998
const EXPECTED_DISCOUNT = 1_000
const EXPECTED_TOTAL = 2_998

describe('promo pricing', () => {
  let fixture: TestFixture
  let percentPromo: Promo

  beforeAll(async () => {
    fixture = await createFixture({ priceCents: PRICE_CENTS, stockCount: 1 })
    percentPromo = await fixture.createPromo({ type: PromoType.PERCENT, value: PERCENT_OFF })
  })

  afterAll(async () => {
    await fixture.cleanup()
  })

  it('computes the expected integer total for a percent promo', () => {
    const breakdown = computeOrderTotal(fixture.plan, QTY, percentPromo)
    expect(breakdown.unitPriceCents).toBe(PRICE_CENTS)
    expect(breakdown.subtotalCents).toBe(EXPECTED_SUBTOTAL)
    expect(breakdown.promoDiscountCents).toBe(EXPECTED_DISCOUNT)
    expect(breakdown.totalCents).toBe(EXPECTED_TOTAL)
    expect(Number.isInteger(breakdown.totalCents)).toBe(true)
  })

  it('persists that same total on the order', async () => {
    const order = await prisma.$transaction((tx) =>
      createOrder(tx, {
        userId: fixture.user.id,
        planId: fixture.plan.id,
        qty: QTY,
        provider: PaymentProvider.BALANCE,
        promoCode: percentPromo.code,
        idempotencyKey: fixture.key('order-percent')
      })
    )

    expect(order.amountCents).toBe(EXPECTED_TOTAL)
    expect(order.promoId).toBe(percentPromo.id)
    expect(order.qty).toBe(QTY)

    const stored = requireDefined(await prisma.order.findUnique({ where: { id: order.id } }), 'the order')
    expect(stored.amountCents).toBe(EXPECTED_TOTAL)
    expect(stored.currency).toBe('USD')
  })

  it('rejects an inactive promo and creates no order', async () => {
    const dead = await fixture.createPromo({ type: PromoType.PERCENT, value: 50, isActive: false })
    const key = fixture.key('order-inactive')

    await expect(
      prisma.$transaction((tx) =>
        createOrder(tx, {
          userId: fixture.user.id,
          planId: fixture.plan.id,
          qty: 1,
          provider: PaymentProvider.BALANCE,
          promoCode: dead.code,
          idempotencyKey: key
        })
      )
    ).rejects.toBeInstanceOf(PromoInvalidError)

    expect(await prisma.order.findUnique({ where: { idempotencyKey: key } })).toBeNull()
  })

  // ───────────────────────────────────────────────────────────────────────────
  // Regression guard: Promo.maxUses used to be unenforceable.
  //
  // pricing.ts validated `usedCount >= maxUses`, but nothing ever incremented
  // Promo.usedCount, so the counter stayed at 0 forever and a "first 100
  // customers" promo was redeemable without limit. createOrder now claims a
  // use atomically (single guarded UPDATE, so concurrent orders cannot both
  // slip past a maxUses=1 cap), and expireOrder/refundOrder give the use back.
  // ───────────────────────────────────────────────────────────────────────────
  it('refuses a second order once a maxUses=1 promo is spent', async () => {
    const limited = await fixture.createPromo({ type: PromoType.PERCENT, value: 10, maxUses: 1 })

    await prisma.$transaction((tx) =>
      createOrder(tx, {
        userId: fixture.user.id,
        planId: fixture.plan.id,
        qty: 1,
        provider: PaymentProvider.BALANCE,
        promoCode: limited.code,
        idempotencyKey: fixture.key('order-limited-1')
      })
    )

    // Second redemption of a one-use promo must be refused.
    await expect(
      prisma.$transaction((tx) =>
        createOrder(tx, {
          userId: fixture.user.id,
          planId: fixture.plan.id,
          qty: 1,
          provider: PaymentProvider.BALANCE,
          promoCode: limited.code,
          idempotencyKey: fixture.key('order-limited-2')
        })
      )
    ).rejects.toBeInstanceOf(PromoInvalidError)
  })
})
