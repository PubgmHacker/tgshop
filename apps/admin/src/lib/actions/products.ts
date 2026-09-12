'use server'

import { revalidatePath } from 'next/cache'
import { prisma, AdminRole, Prisma } from '@tgshop/db'
import { hasRole, requireRole } from '../rbac'
import { writeAuditLog } from '../audit'
import { productUpsertSchema, type ProductUpsertInput } from '../schemas'

export async function listProductsAction(categoryId?: string) {
  const session = await requireRole(AdminRole.SUPPORT)
  const products = await prisma.product.findMany({
    where: categoryId ? { categoryId } : undefined,
    orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
    include: { category: true, _count: { select: { plans: true } } }
  })
  return products.map((product) => ({
    ...product,
    externalConfig: hasRole(session.role, AdminRole.ADMIN) ? product.externalConfig : null
  }))
}

export async function getProductAction(id: string) {
  const session = await requireRole(AdminRole.SUPPORT)
  const product = await prisma.product.findUnique({ where: { id }, include: { category: true, plans: true } })
  return product ? { ...product, externalConfig: hasRole(session.role, AdminRole.ADMIN) ? product.externalConfig : null } : null
}

export async function upsertProductAction(input: ProductUpsertInput) {
  const session = await requireRole(AdminRole.ADMIN)
  const data = productUpsertSchema.parse(input)

  const fields = {
    categoryId: data.categoryId,
    title: data.title,
    slug: data.slug,
    description: data.description,
    imageUrl: data.imageUrl ?? null,
    deliveryType: data.deliveryType,
    externalConfig: data.externalConfig === null ? Prisma.DbNull : data.externalConfig as Prisma.InputJsonValue | undefined,
    isActive: data.isActive,
    sortOrder: data.sortOrder
  }

  const product = data.id
    ? await prisma.product.update({ where: { id: data.id }, data: fields })
    : await prisma.product.create({ data: fields })

  const { externalConfig, ...auditable } = data
  await writeAuditLog({
    actorId: session.adminId,
    action: data.id ? 'product.update' : 'product.create',
    entity: 'Product',
    entityId: product.id,
    diff: { ...auditable, ...(externalConfig !== undefined ? { externalConfigChanged: true } : {}) } as Prisma.InputJsonValue
  })

  revalidatePath('/products')
  return product
}

export async function deleteProductAction(id: string) {
  const session = await requireRole(AdminRole.OWNER)
  await prisma.product.delete({ where: { id } })
  await writeAuditLog({ actorId: session.adminId, action: 'product.delete', entity: 'Product', entityId: id })
  revalidatePath('/products')
}
