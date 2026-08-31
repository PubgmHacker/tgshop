import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { prisma, DeliveryType, Prisma, StockStatus } from '@tgshop/db'
import { getSetting } from '@tgshop/core'
import { badRequest, conflict, notFound, sendError } from '../../../../lib/httpErrors.js'
import { requestLocale } from '../context.js'
import { prismaErrorCode, writeAdminAudit } from './shared.js'
import { createNewProductBroadcastDraft } from '../../../../domain/new-product-broadcast.js'
import { publishPost } from '../../../../domain/content.js'
import { redis } from '../../../../config/redis.js'
import { logger } from '../../../../lib/logger.js'

// ─────────────────────────────────────────────────────────────────────────────
// GET    /api/admin/catalog          — full tree incl. inactive + stock counts
// POST   /api/admin/categories       PATCH/DELETE /api/admin/categories/:id
// POST   /api/admin/products         PATCH/DELETE /api/admin/products/:id
// POST   /api/admin/plans            PATCH/DELETE /api/admin/plans/:id
//
// Deactivation (isActive=false) is the everyday "remove from storefront"
// switch; DELETE exists for objects created by mistake and answers 409 the
// moment anything references them (orders, stock, promos, child rows).
// ─────────────────────────────────────────────────────────────────────────────

const idParamsSchema = z.object({ id: z.string().min(1).max(64) })

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase latin, digits and single dashes')

const categoryCreateSchema = z.object({
  title: z.string().trim().min(1).max(120),
  slug: slugSchema,
  emoji: z.string().trim().min(1).max(16).nullish(),
  sortOrder: z.number().int().min(0).max(100_000).default(0),
  isActive: z.boolean().default(true)
})

const categoryPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    slug: slugSchema,
    emoji: z.string().trim().min(1).max(16).nullable(),
    sortOrder: z.number().int().min(0).max(100_000),
    isActive: z.boolean()
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'empty patch')

const productCreateSchema = z.object({
  categoryId: z.string().min(1).max(64),
  title: z.string().trim().min(1).max(160),
  slug: slugSchema,
  description: z.string().trim().min(1).max(4000),
  imageUrl: z.string().trim().url().max(500).nullish(),
  deliveryType: z.nativeEnum(DeliveryType),
  externalConfig: z.record(z.string(), z.unknown()).nullish(),
  sortOrder: z.number().int().min(0).max(100_000).default(0),
  isActive: z.boolean().default(true)
})

const productPatchSchema = z
  .object({
    categoryId: z.string().min(1).max(64),
    title: z.string().trim().min(1).max(160),
    slug: slugSchema,
    description: z.string().trim().min(1).max(4000),
    imageUrl: z.string().trim().url().max(500).nullable(),
    deliveryType: z.nativeEnum(DeliveryType),
    /** null clears the config; an object replaces it wholesale. */
    externalConfig: z.record(z.string(), z.unknown()).nullable(),
    sortOrder: z.number().int().min(0).max(100_000),
    isActive: z.boolean()
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'empty patch')

const planCreateSchema = z.object({
  productId: z.string().min(1).max(64),
  title: z.string().trim().min(1).max(160),
  durationDays: z.number().int().min(1).max(36_500).nullish(),
  priceCents: z.number().int().min(1).max(100_000_000),
  priceStars: z.number().int().min(1).max(100_000_000).nullish(),
  discountPercent: z.number().int().min(0).max(99).default(0),
  lowStockThreshold: z.number().int().min(0).max(100_000).default(3),
  sortOrder: z.number().int().min(0).max(100_000).default(0),
  isActive: z.boolean().default(true)
})

const planPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    durationDays: z.number().int().min(1).max(36_500).nullable(),
    priceCents: z.number().int().min(1).max(100_000_000),
    priceStars: z.number().int().min(1).max(100_000_000).nullable(),
    discountPercent: z.number().int().min(0).max(99),
    lowStockThreshold: z.number().int().min(0).max(100_000),
    sortOrder: z.number().int().min(0).max(100_000),
    isActive: z.boolean()
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'empty patch')

/** P2002 unique violation → 409, P2025 missing row → 404, P2003 broken FK → mapped key. */
function mapPrismaError(err: unknown, fkMessageKey?: string): unknown {
  const code = prismaErrorCode(err)
  if (code === 'P2002') return conflict()
  if (code === 'P2025') return notFound()
  if (code === 'P2003' || code === 'P2014') {
    return fkMessageKey ? badRequest(fkMessageKey) : conflict('api.errors.in_use')
  }
  return err
}

function externalConfigValue(
  value: Record<string, unknown> | null | undefined
): Prisma.InputJsonValue | typeof Prisma.DbNull | undefined {
  if (value === undefined) return undefined
  if (value === null) return Prisma.DbNull
  return value as Prisma.InputJsonValue
}

/** Creates the safe-by-default announcement and optionally queues it. */
async function announceProductIfConfigured(req: FastifyRequest, product: {
  id: string
  title: string
  slug: string
  description: string
  imageUrl: string | null
  isActive: boolean
}): Promise<{ draftId: string; queued: boolean } | null> {
  if (!product.isActive) return null

  const draft = await createNewProductBroadcastDraft(product)
  const autoQueue = await getSetting(prisma, 'new_product_auto_broadcast', redis)
  const published = autoQueue ? await publishPost(draft.id) : draft
  await writeAdminAudit(req, autoQueue ? 'broadcast.auto_queue' : 'broadcast.auto_draft', 'BroadcastPost', draft.id, {
    productId: product.id,
    productSlug: product.slug,
    autoQueue
  }).catch((err) => logger.error({ err, postId: draft.id }, 'new-product broadcast audit write failed'))

  return { draftId: draft.id, queued: published.status === 'QUEUED' }
}

export function registerAdminCatalogRoutes(app: FastifyInstance): void {
  app.get('/api/admin/catalog', async (req, reply) => {
    try {
      const [categories, stockGroups] = await Promise.all([
        prisma.category.findMany({
          orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
          include: {
            products: {
              orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
              include: { plans: { orderBy: [{ sortOrder: 'asc' }, { priceCents: 'asc' }] } }
            }
          }
        }),
        prisma.stockItem.groupBy({ by: ['planId', 'status'], _count: { _all: true } })
      ])

      const stockByPlan = new Map<string, { available: number; reserved: number; sold: number }>()
      for (const group of stockGroups) {
        const entry = stockByPlan.get(group.planId) ?? { available: 0, reserved: 0, sold: 0 }
        if (group.status === StockStatus.AVAILABLE) entry.available = group._count._all
        else if (group.status === StockStatus.RESERVED) entry.reserved = group._count._all
        else entry.sold = group._count._all
        stockByPlan.set(group.planId, entry)
      }

      return {
        categories: categories.map((category) => ({
          id: category.id,
          title: category.title,
          slug: category.slug,
          emoji: category.emoji,
          sortOrder: category.sortOrder,
          isActive: category.isActive,
          products: category.products.map((product) => ({
            id: product.id,
            title: product.title,
            slug: product.slug,
            description: product.description,
            imageUrl: product.imageUrl,
            deliveryType: product.deliveryType,
            externalConfig: product.externalConfig ?? null,
            sortOrder: product.sortOrder,
            isActive: product.isActive,
            plans: product.plans.map((plan) => {
              const stock = stockByPlan.get(plan.id) ?? { available: 0, reserved: 0, sold: 0 }
              return {
                id: plan.id,
                title: plan.title,
                durationDays: plan.durationDays,
                priceCents: plan.priceCents,
                priceStars: plan.priceStars,
                discountPercent: plan.discountPercent,
                lowStockThreshold: plan.lowStockThreshold,
                sortOrder: plan.sortOrder,
                isActive: plan.isActive,
                stock
              }
            })
          }))
        }))
      }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })

  // ── Categories ─────────────────────────────────────────────────────────────

  app.post('/api/admin/categories', async (req, reply) => {
    try {
      const body = categoryCreateSchema.parse(req.body)
      const category = await prisma.category
        .create({
          data: {
            title: body.title,
            slug: body.slug,
            emoji: body.emoji ?? null,
            sortOrder: body.sortOrder,
            isActive: body.isActive
          }
        })
        .catch((err) => {
          throw mapPrismaError(err)
        })
      await writeAdminAudit(req, 'category.create', 'Category', category.id, { title: body.title, slug: body.slug })
      reply.code(201)
      return { id: category.id }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })

  app.patch('/api/admin/categories/:id', async (req, reply) => {
    try {
      const { id } = idParamsSchema.parse(req.params)
      const body = categoryPatchSchema.parse(req.body)
      await prisma.category.update({ where: { id }, data: body }).catch((err) => {
        throw mapPrismaError(err)
      })
      await writeAdminAudit(req, 'category.update', 'Category', id, body as Prisma.InputJsonValue)
      return { id }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })

  app.delete('/api/admin/categories/:id', async (req, reply) => {
    try {
      const { id } = idParamsSchema.parse(req.params)
      await prisma.category.delete({ where: { id } }).catch((err) => {
        throw mapPrismaError(err)
      })
      await writeAdminAudit(req, 'category.delete', 'Category', id)
      return { id, deleted: true }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })

  // ── Products ───────────────────────────────────────────────────────────────

  app.post('/api/admin/products', async (req, reply) => {
    try {
      const body = productCreateSchema.parse(req.body)
      const product = await prisma.product
        .create({
          data: {
            categoryId: body.categoryId,
            title: body.title,
            slug: body.slug,
            description: body.description,
            imageUrl: body.imageUrl ?? null,
            deliveryType: body.deliveryType,
            ...(body.externalConfig != null ? { externalConfig: body.externalConfig as Prisma.InputJsonValue } : {}),
            sortOrder: body.sortOrder,
            isActive: body.isActive
          }
        })
        .catch((err) => {
          throw mapPrismaError(err, 'api.errors.category_not_found')
        })
      await writeAdminAudit(req, 'product.create', 'Product', product.id, { title: body.title, slug: body.slug })
      let broadcastDraftId: string | null = null
      if (product.isActive) {
        try {
          broadcastDraftId = (await announceProductIfConfigured(req, product))?.draftId ?? null
        } catch (err) {
          // Product creation is the primary mutation. A temporary Redis/DB
          // issue in the optional announcement path must not make an admin
          // retry the product form and create a duplicate product.
          logger.error({ err, productId: product.id }, 'failed to create new-product broadcast draft')
        }
      }
      reply.code(201)
      return { id: product.id, broadcastDraftId }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })

  app.patch('/api/admin/products/:id', async (req, reply) => {
    try {
      const { id } = idParamsSchema.parse(req.params)
      const body = productPatchSchema.parse(req.body)
      const { externalConfig, ...rest } = body
      const configUpdate = externalConfigValue(externalConfig)
      const existing = await prisma.product.findUnique({ where: { id } })
      if (!existing) throw notFound('api.errors.product_not_found')
      const product = await prisma.product
        .update({
          where: { id },
          data: { ...rest, ...(configUpdate !== undefined ? { externalConfig: configUpdate } : {}) }
        })
        .catch((err) => {
          throw mapPrismaError(err, 'api.errors.category_not_found')
        })
      const { externalConfig: _cfg, ...auditable } = body
      await writeAdminAudit(req, 'product.update', 'Product', id, {
        ...auditable,
        ...(externalConfig !== undefined ? { externalConfigChanged: true } : {})
      } as Prisma.InputJsonValue)
      if (body.isActive === true && !existing.isActive && product.isActive) {
        try {
          await announceProductIfConfigured(req, product)
        } catch (err) {
          logger.error({ err, productId: product.id }, 'failed to create activation broadcast draft')
        }
      }
      return { id }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })

  app.delete('/api/admin/products/:id', async (req, reply) => {
    try {
      const { id } = idParamsSchema.parse(req.params)
      await prisma.product.delete({ where: { id } }).catch((err) => {
        throw mapPrismaError(err)
      })
      await writeAdminAudit(req, 'product.delete', 'Product', id)
      return { id, deleted: true }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })

  // ── Plans ──────────────────────────────────────────────────────────────────

  app.post('/api/admin/plans', async (req, reply) => {
    try {
      const body = planCreateSchema.parse(req.body)
      const plan = await prisma.plan
        .create({
          data: {
            productId: body.productId,
            title: body.title,
            durationDays: body.durationDays ?? null,
            priceCents: body.priceCents,
            priceStars: body.priceStars ?? null,
            discountPercent: body.discountPercent,
            lowStockThreshold: body.lowStockThreshold,
            sortOrder: body.sortOrder,
            isActive: body.isActive
          }
        })
        .catch((err) => {
          throw mapPrismaError(err, 'api.errors.product_not_found')
        })
      await writeAdminAudit(req, 'plan.create', 'Plan', plan.id, {
        title: body.title,
        priceCents: body.priceCents,
        productId: body.productId
      })
      reply.code(201)
      return { id: plan.id }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })

  app.patch('/api/admin/plans/:id', async (req, reply) => {
    try {
      const { id } = idParamsSchema.parse(req.params)
      const body = planPatchSchema.parse(req.body)
      await prisma.plan.update({ where: { id }, data: body }).catch((err) => {
        throw mapPrismaError(err)
      })
      await writeAdminAudit(req, 'plan.update', 'Plan', id, body as Prisma.InputJsonValue)
      return { id }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })

  app.delete('/api/admin/plans/:id', async (req, reply) => {
    try {
      const { id } = idParamsSchema.parse(req.params)
      await prisma.plan.delete({ where: { id } }).catch((err) => {
        throw mapPrismaError(err)
      })
      await writeAdminAudit(req, 'plan.delete', 'Plan', id)
      return { id, deleted: true }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })
}
