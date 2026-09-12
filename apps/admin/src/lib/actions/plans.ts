'use server'

import { revalidatePath } from 'next/cache'
import { prisma, AdminRole, type Prisma } from '@tgshop/db'
import { isPoolBacked } from '@tgshop/core'
import { requireRole } from '../rbac'
import { writeAuditLog } from '../audit'
import { planUpsertSchema, type PlanUpsertInput } from '../schemas'

export async function listPlansAction(productId?: string) {
  await requireRole(AdminRole.SUPPORT)
  const plans = await prisma.plan.findMany({
    where: productId ? { productId } : undefined,
    orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
    include: {
      product: { select: { id: true, title: true, deliveryType: true, externalConfig: true } },
      _count: { select: { stockItems: { where: { status: 'AVAILABLE' } } } }
    }
  })
  return plans.map(({ product, ...plan }) => ({
    ...plan,
    usesStock: isPoolBacked(product.deliveryType, product.externalConfig),
    product: { id: product.id, title: product.title, deliveryType: product.deliveryType }
  }))
}

export async function upsertPlanAction(input: PlanUpsertInput) {
  const session = await requireRole(AdminRole.ADMIN)
  const data = planUpsertSchema.parse(input)

  const fields = {
    productId: data.productId,
    title: data.title,
    durationDays: data.durationDays ?? null,
    priceCents: data.priceCents,
    priceStars: data.priceStars ?? null,
    discountPercent: data.discountPercent,
    lowStockThreshold: data.lowStockThreshold,
    isActive: data.isActive,
    sortOrder: data.sortOrder
  }

  const plan = data.id
    ? await prisma.plan.update({ where: { id: data.id }, data: fields })
    : await prisma.plan.create({ data: fields })

  await writeAuditLog({
    actorId: session.adminId,
    action: data.id ? 'plan.update' : 'plan.create',
    entity: 'Plan',
    entityId: plan.id,
    diff: data as unknown as Prisma.InputJsonValue
  })

  revalidatePath('/plans')
  return plan
}

export async function deletePlanAction(id: string) {
  const session = await requireRole(AdminRole.OWNER)
  await prisma.plan.delete({ where: { id } })
  await writeAuditLog({ actorId: session.adminId, action: 'plan.delete', entity: 'Plan', entityId: id })
  revalidatePath('/plans')
}
