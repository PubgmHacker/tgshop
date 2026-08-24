import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma, PromoType, type Prisma } from '@tgshop/db'
import { badRequest, conflict, notFound, sendError } from '../../../../lib/httpErrors.js'
import { requestLocale } from '../context.js'
import { prismaErrorCode, writeAdminAudit } from './shared.js'

// ─────────────────────────────────────────────────────────────────────────────
// GET   /api/admin/promos
// POST  /api/admin/promos
// PATCH /api/admin/promos/:id
//
// PERCENT promos carry value 1–100; FIXED promos carry integer cents ≥ 1. The
// pair is validated together on both create and patch (a patch re-validates
// against the merged row) so a stored promo can never be internally invalid.
// ─────────────────────────────────────────────────────────────────────────────

const idParamsSchema = z.object({ id: z.string().min(1).max(64) })

const codeSchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'latin letters, digits, dash and underscore')

const promoCreateSchema = z.object({
  code: codeSchema,
  type: z.nativeEnum(PromoType),
  value: z.number().int().min(1),
  maxUses: z.number().int().min(1).max(1_000_000).nullish(),
  expiresAt: z.string().datetime({ offset: true }).nullish(),
  planId: z.string().min(1).max(64).nullish(),
  isActive: z.boolean().default(true)
})

const promoPatchSchema = z
  .object({
    code: codeSchema,
    type: z.nativeEnum(PromoType),
    value: z.number().int().min(1),
    maxUses: z.number().int().min(1).max(1_000_000).nullable(),
    expiresAt: z.string().datetime({ offset: true }).nullable(),
    planId: z.string().min(1).max(64).nullable(),
    isActive: z.boolean()
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'empty patch')

function assertValueMatchesType(type: PromoType, value: number): void {
  if (type === PromoType.PERCENT && (value < 1 || value > 100)) {
    throw badRequest('api.errors.validation')
  }
  if (type === PromoType.FIXED && value < 1) {
    throw badRequest('api.errors.validation')
  }
}

function mapPromoError(err: unknown): unknown {
  const code = prismaErrorCode(err)
  if (code === 'P2002') return conflict()
  if (code === 'P2025') return notFound()
  if (code === 'P2003') return badRequest('api.errors.plan_not_found')
  return err
}

export function registerAdminPromoRoutes(app: FastifyInstance): void {
  app.get('/api/admin/promos', async (req, reply) => {
    try {
      const promos = await prisma.promo.findMany({
        orderBy: [{ isActive: 'desc' }, { code: 'asc' }],
        include: { plan: { select: { id: true, title: true, product: { select: { title: true } } } } }
      })
      return {
        promos: promos.map((promo) => ({
          id: promo.id,
          code: promo.code,
          type: promo.type,
          value: promo.value,
          maxUses: promo.maxUses,
          usedCount: promo.usedCount,
          expiresAt: promo.expiresAt ? promo.expiresAt.toISOString() : null,
          planId: promo.planId,
          planTitle: promo.plan ? `${promo.plan.product.title} · ${promo.plan.title}` : null,
          isActive: promo.isActive
        }))
      }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })

  app.post('/api/admin/promos', async (req, reply) => {
    try {
      const body = promoCreateSchema.parse(req.body)
      assertValueMatchesType(body.type, body.value)

      const promo = await prisma.promo
        .create({
          data: {
            code: body.code,
            type: body.type,
            value: body.value,
            maxUses: body.maxUses ?? null,
            expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
            planId: body.planId ?? null,
            isActive: body.isActive
          }
        })
        .catch((err) => {
          throw mapPromoError(err)
        })

      await writeAdminAudit(req, 'promo.create', 'Promo', promo.id, {
        code: body.code,
        type: body.type,
        value: body.value
      })
      reply.code(201)
      return { id: promo.id }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })

  app.patch('/api/admin/promos/:id', async (req, reply) => {
    try {
      const { id } = idParamsSchema.parse(req.params)
      const body = promoPatchSchema.parse(req.body)

      const existing = await prisma.promo.findUnique({ where: { id } })
      if (!existing) throw notFound()

      assertValueMatchesType(body.type ?? existing.type, body.value ?? existing.value)

      const data: Prisma.PromoUpdateInput = {}
      if (body.code !== undefined) data.code = body.code
      if (body.type !== undefined) data.type = body.type
      if (body.value !== undefined) data.value = body.value
      if (body.maxUses !== undefined) data.maxUses = body.maxUses
      if (body.expiresAt !== undefined) data.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null
      if (body.planId !== undefined) {
        data.plan = body.planId ? { connect: { id: body.planId } } : { disconnect: true }
      }
      if (body.isActive !== undefined) data.isActive = body.isActive

      await prisma.promo.update({ where: { id }, data }).catch((err) => {
        throw mapPromoError(err)
      })

      const { planId: _p, ...auditable } = body
      await writeAdminAudit(req, 'promo.update', 'Promo', id, {
        ...auditable,
        ...(body.planId !== undefined ? { planId: body.planId } : {})
      } as Prisma.InputJsonValue)
      return { id }
    } catch (err) {
      await sendError(reply, err, requestLocale(req))
      return
    }
  })
}
