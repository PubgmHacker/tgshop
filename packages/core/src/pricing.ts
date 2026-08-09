import type { Plan, Promo } from '@tgshop/db'
import { PromoType } from '@tgshop/db'
import { applyFixedDiscount, applyPercentDiscount, multiplyCents } from './money.js'
import { PromoInvalidError } from './errors.js'

export interface PricingBreakdown {
  planId: string
  qty: number
  unitPriceCents: number
  subtotalCents: number
  promoCode: string | null
  promoDiscountCents: number
  totalCents: number
}

/** Validates that a promo can be applied to the given plan, at the given point in time. Throws PromoInvalidError otherwise. */
export function validatePromo(promo: Promo, plan: Plan, now: Date = new Date()): void {
  if (!promo.isActive) {
    throw new PromoInvalidError(`promo ${promo.code} is not active`)
  }
  if (promo.expiresAt && promo.expiresAt.getTime() < now.getTime()) {
    throw new PromoInvalidError(`promo ${promo.code} has expired`)
  }
  if (promo.maxUses !== null && promo.usedCount >= promo.maxUses) {
    throw new PromoInvalidError(`promo ${promo.code} has no uses left`)
  }
  if (promo.planId !== null && promo.planId !== plan.id) {
    throw new PromoInvalidError(`promo ${promo.code} is not valid for plan ${plan.id}`)
  }
  if (promo.type === PromoType.PERCENT && (promo.value < 0 || promo.value > 100)) {
    throw new PromoInvalidError(`promo ${promo.code} has an invalid percent value ${promo.value}`)
  }
  if (promo.type === PromoType.FIXED && promo.value < 0) {
    throw new PromoInvalidError(`promo ${promo.code} has an invalid fixed value ${promo.value}`)
  }
}

/**
 * Computes the full price breakdown for an order: plan unit price * qty, minus
 * the plan's own discountPercent, minus an optional promo (validated first).
 */
export function computeOrderTotal(
  plan: Plan,
  qty: number,
  promo: Promo | null = null,
  now: Date = new Date()
): PricingBreakdown {
  if (!Number.isInteger(qty) || qty < 1) {
    throw new RangeError(`computeOrderTotal expects a positive integer qty, got ${qty}`)
  }

  const unitAfterPlanDiscount =
    plan.discountPercent > 0 ? applyPercentDiscount(plan.priceCents, plan.discountPercent) : plan.priceCents

  const subtotalCents = multiplyCents(unitAfterPlanDiscount, qty)

  let promoDiscountCents = 0
  if (promo) {
    validatePromo(promo, plan, now)
    if (promo.type === PromoType.PERCENT) {
      promoDiscountCents = subtotalCents - applyPercentDiscount(subtotalCents, promo.value)
    } else {
      promoDiscountCents = subtotalCents - applyFixedDiscount(subtotalCents, promo.value)
    }
  }

  const totalCents = Math.max(0, subtotalCents - promoDiscountCents)

  return {
    planId: plan.id,
    qty,
    unitPriceCents: unitAfterPlanDiscount,
    subtotalCents,
    promoCode: promo?.code ?? null,
    promoDiscountCents,
    totalCents
  }
}
