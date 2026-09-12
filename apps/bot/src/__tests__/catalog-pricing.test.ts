import { describe, expect, it, vi } from 'vitest'
import type { Plan, Product } from '@tgshop/db'
import { computeOrderTotal } from '@tgshop/core'
vi.mock('../config/redis.js', () => ({ redis: {} }))
const { toProductSummaryDto } = await import('../server/routes/api/presenters.js')

const product = { id: 'product', title: 'Product', slug: 'product', imageUrl: null, deliveryType: 'STOCK_POOL', externalConfig: null } as Product
const plan = { id: 'half-cent', priceCents: 101, discountPercent: 50, lowStockThreshold: 1 } as Plan

describe('catalog quotes', () => {
  it('uses the same half-cent rounding as the amount charged', () => {
    const summary = toProductSummaryDto(product, 'code', [plan], new Map([[plan.id, 1]]))
    expect(summary.minPriceCents).toBe(50)
    expect(summary.minPriceCents).toBe(computeOrderTotal(plan, 1).totalCents)
  })
  it('does not advertise a cheaper sold-out plan when another plan is available', () => {
    const available = { ...plan, id: 'available', priceCents: 300, discountPercent: 0 }
    const summary = toProductSummaryDto(product, 'code', [plan, available], new Map([[available.id, 1]]))
    expect(summary.minPriceCents).toBe(300)
    expect(summary.inStock).toBe(true)
  })
})
