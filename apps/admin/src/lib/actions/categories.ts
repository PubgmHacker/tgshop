'use server'

import { revalidatePath } from 'next/cache'
import { prisma, AdminRole } from '@tgshop/db'
import { requireRole } from '../rbac'
import { writeAuditLog } from '../audit'
import { categoryUpsertSchema, type CategoryUpsertInput } from '../schemas'

export async function listCategoriesAction() {
  await requireRole(AdminRole.SUPPORT)
  return prisma.category.findMany({
    orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
    include: { _count: { select: { products: true } } }
  })
}

export async function upsertCategoryAction(input: CategoryUpsertInput) {
  const session = await requireRole(AdminRole.ADMIN)
  const data = categoryUpsertSchema.parse(input)

  const fields = {
    title: data.title,
    slug: data.slug,
    emoji: data.emoji ?? null,
    sortOrder: data.sortOrder,
    isActive: data.isActive
  }

  const category = data.id
    ? await prisma.category.update({ where: { id: data.id }, data: fields })
    : await prisma.category.create({ data: fields })

  await writeAuditLog({
    actorId: session.adminId,
    action: data.id ? 'category.update' : 'category.create',
    entity: 'Category',
    entityId: category.id,
    diff: data
  })

  revalidatePath('/categories')
  return category
}

export async function deleteCategoryAction(id: string) {
  const session = await requireRole(AdminRole.OWNER)
  await prisma.category.delete({ where: { id } })
  await writeAuditLog({ actorId: session.adminId, action: 'category.delete', entity: 'Category', entityId: id })
  revalidatePath('/categories')
}
