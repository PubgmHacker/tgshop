'use server'

import { revalidatePath } from 'next/cache'
import { prisma, AdminRole, type Prisma } from '@tgshop/db'
import { requireRole } from '../rbac'
import { writeAuditLog } from '../audit'
import { promoUpsertSchema, type PromoUpsertInput } from '../schemas'

export async function listPromosAction() {
  await requireRole(AdminRole.SUPPORT)
  return prisma.promo.findMany({ orderBy: { code: 'asc' }, include: { plan: true } })
}

export async function upsertPromoAction(input: PromoUpsertInput) {
  const session = await requireRole(AdminRole.ADMIN)
  const data = promoUpsertSchema.parse(input)

  const fields = {
    code: data.code,
    type: data.type,
    value: data.value,
    maxUses: data.maxUses ?? null,
    expiresAt: data.expiresAt ?? null,
    planId: data.planId ?? null,
    isActive: data.isActive
  }

  const promo = data.id
    ? await prisma.promo.update({ where: { id: data.id }, data: fields })
    : await prisma.promo.create({ data: fields })

  await writeAuditLog({
    actorId: session.adminId,
    action: data.id ? 'promo.update' : 'promo.create',
    entity: 'Promo',
    entityId: promo.id,
    diff: data as unknown as Prisma.InputJsonValue
  })

  revalidatePath('/promos')
  return promo
}

export async function deletePromoAction(id: string) {
  const session = await requireRole(AdminRole.OWNER)
  await prisma.promo.delete({ where: { id } })
  await writeAuditLog({ actorId: session.adminId, action: 'promo.delete', entity: 'Promo', entityId: id })
  revalidatePath('/promos')
}
