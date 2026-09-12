import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { getFullCatalog } from '../../../domain/catalog.js'
import { countAvailableForPlans } from '../../../domain/stock.js'
import { isPoolBacked, applyPercentDiscount, compareProductPriority, productPromotion } from '@tgshop/core'
import { sendError } from '../../../lib/httpErrors.js'
import { requestLocale } from './context.js'

// ─────────────────────────────────────────────────────────────────────────────
// Public, read-only catalog for the marketing landing page.
//
// This route intentionally exposes only active product copy, prices and
// availability. It never exposes stock payloads, users, orders or provider
// configuration. The customer Mini App still uses the authenticated /api/*
// routes; the landing page needs this small public projection so its catalog
// cannot silently drift into a hard-coded demo.
// ─────────────────────────────────────────────────────────────────────────────

interface PublicPlan {
  id: string
  title: string
  priceCents: number
  durationDays: number | null
  badge?: string
}

function effectivePrice(plan: { priceCents: number; discountPercent: number }): number {
  return applyPercentDiscount(plan.priceCents, plan.discountPercent)
}

async function handlePublicCatalog(req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  try {
    const categories = await getFullCatalog()
    const plans = categories.flatMap((category) =>
      category.products.flatMap((product) => product.plans.map((plan) => ({ plan, product })))
    )
    const availability = await countAvailableForPlans(plans.map(({ plan }) => plan.id))

    const products = categories.flatMap((category) =>
      category.products.flatMap((product) => {
        const publicPlans: PublicPlan[] = product.plans
          .filter((plan) => {
            if (!isPoolBacked(product.deliveryType, product.externalConfig)) return true
            return (availability.get(plan.id) ?? 0) > 0
          })
          .map((plan) => ({
            id: plan.id,
            title: plan.title,
            priceCents: effectivePrice(plan),
            durationDays: plan.durationDays,
            ...(plan.discountPercent > 0 ? { badge: `-${plan.discountPercent}%` } : {})
          }))

        if (publicPlans.length === 0) return []
        return [
          {
            id: product.id,
            slug: product.slug,
            title: product.title,
            description: product.description,
            categoryTitle: category.title,
            imageUrl: product.imageUrl,
            promotion: productPromotion(product.slug),
            plans: publicPlans
          }
        ]
      })
    )

    products.sort(compareProductPriority)

    reply.header('cache-control', 'public, max-age=60, stale-while-revalidate=300')
    return { products }
  } catch (err) {
    await sendError(reply, err, requestLocale(req))
    return
  }
}

export function registerPublicCatalogRoutes(app: FastifyInstance): void {
  // Keep the legacy /public/catalog spelling as a compatibility alias for
  // existing landing deployments while the canonical route lives under /api.
  app.get('/api/public/catalog', handlePublicCatalog)
  app.get('/public/catalog', handlePublicCatalog)
}
