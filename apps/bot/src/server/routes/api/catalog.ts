import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@tgshop/db'
import { getFullCatalog, getCategoryBySlug, getProductBySlug, listActiveCategories } from '../../../domain/catalog.js'
import { countAvailableForPlans } from '../../../domain/stock.js'
import { notFound, sendError } from '../../../lib/httpErrors.js'
import { requestLocale } from './context.js'
import {
  toCategoryDto,
  toProductDetailDto,
  toProductSummaryDto,
  type CategoryDto,
  type ProductSummaryDto
} from './presenters.js'

// ─────────────────────────────────────────────────────────────────────────────
// Catalog reads for the Mini App. All shapes are pinned by
// apps/miniapp/src/types/api.ts.
//
// Every listing resolves stock for all plans in ONE grouped query
// (countAvailableForPlans) rather than per plan, so rendering the whole catalog
// stays at a constant number of round trips.
// ─────────────────────────────────────────────────────────────────────────────

const slugParamSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9][a-z0-9-]*$/i, 'invalid slug')
})

const HOME_BESTSELLER_LIMIT = 8

interface HomeBannerDto {
  id: string
  imageUrl: string
  title: string | null
  href: string | null
}

/**
 * Home banners live in the Setting table under `home_banners` (an array of
 * {id, imageUrl, title?, href?}), so merchandising can change without a deploy.
 * Malformed or absent config degrades to no banners rather than a 500.
 */
const bannerSchema = z.object({
  id: z.string(),
  imageUrl: z.string(),
  title: z.string().nullish(),
  href: z.string().nullish()
})

async function loadBanners(): Promise<HomeBannerDto[]> {
  const setting = await prisma.setting.findUnique({ where: { key: 'home_banners' } })
  if (!setting) return []
  const parsed = z.array(bannerSchema).safeParse(setting.value)
  if (!parsed.success) return []
  return parsed.data.map((banner) => ({
    id: banner.id,
    imageUrl: banner.imageUrl,
    title: banner.title ?? null,
    href: banner.href ?? null
  }))
}

export function registerCatalogRoutes(app: FastifyInstance): void {
  // GET /api/home — banners + categories + bestsellers for the landing screen.
  app.get('/api/home', async (req, reply) => {
    try {
      const [banners, categories] = await Promise.all([loadBanners(), getFullCatalog()])

      const allPlanIds = categories.flatMap((c) => c.products.flatMap((p) => p.plans.map((plan) => plan.id)))
      const availability = await countAvailableForPlans(allPlanIds)

      const bestsellers: ProductSummaryDto[] = []
      for (const category of categories) {
        for (const product of category.products) {
          bestsellers.push(toProductSummaryDto(product, category.slug, product.plans, availability))
        }
      }

      // In-stock first, then cheapest — a stable, useful default until real
      // sales-volume ranking is wired in from /internal/top-products.
      bestsellers.sort((a, b) => {
        if (a.slug === 'mirasim' && b.slug !== 'mirasim') return -1
        if (b.slug === 'mirasim' && a.slug !== 'mirasim') return 1
        if (a.inStock !== b.inStock) return a.inStock ? -1 : 1
        return a.minPriceCents - b.minPriceCents
      })

      const categoryDtos: CategoryDto[] = categories.map((category) => ({
        ...toCategoryDto(category), productCount: category.products.length
      }))

      return {
        banners,
        categories: categoryDtos,
        bestsellers: bestsellers.slice(0, HOME_BESTSELLER_LIMIT)
      }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })

  // GET /api/categories — flat list of active categories.
  app.get('/api/categories', async (req, reply) => {
    try {
      const categories = await listActiveCategories()
      return { categories: categories.map(toCategoryDto) }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })

  // GET /api/categories/:slug — one category plus its products.
  app.get('/api/categories/:slug', async (req, reply) => {
    try {
      const { slug } = slugParamSchema.parse(req.params)
      const category = await getCategoryBySlug(slug)
      if (!category) throw notFound('api.errors.category_not_found')

      const products = await prisma.product.findMany({
        where: { categoryId: category.id, isActive: true },
        orderBy: { sortOrder: 'asc' },
        include: { plans: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } }
      })

      const availability = await countAvailableForPlans(products.flatMap((p) => p.plans.map((plan) => plan.id)))

      return {
        category: toCategoryDto(category),
        products: products.map((product) => toProductSummaryDto(product, category.slug, product.plans, availability))
      }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })

  // GET /api/products/:slug — product detail with its purchasable plans.
  app.get('/api/products/:slug', async (req, reply) => {
    try {
      const { slug } = slugParamSchema.parse(req.params)
      const product = await getProductBySlug(slug)
      if (!product) throw notFound('api.errors.product_not_found')

      const availability = await countAvailableForPlans(product.plans.map((plan) => plan.id))
      return toProductDetailDto(product, product.category, product.plans, availability)
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })

  // GET /api/catalog — the whole tree in one call (categories > products > plans).
  app.get('/api/catalog', async (req, reply) => {
    try {
      const categories = await getFullCatalog()
      const availability = await countAvailableForPlans(
        categories.flatMap((c) => c.products.flatMap((p) => p.plans.map((plan) => plan.id)))
      )

      return {
        categories: categories.map((category) => ({
          ...toCategoryDto(category),
          products: category.products.map((product) =>
            toProductDetailDto(product, category, product.plans, availability)
          )
        }))
      }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })
}
