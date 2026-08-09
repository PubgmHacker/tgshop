import { prisma } from '@tgshop/db'

/** Read-only catalog queries used by both the bot menus and the Mini App API. */

export async function listActiveCategories() {
  return prisma.category.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' }
  })
}

export async function getCategoryBySlug(slug: string) {
  return prisma.category.findFirst({ where: { slug, isActive: true } })
}

export async function listActiveProducts(categoryId: string) {
  return prisma.product.findMany({
    where: { categoryId, isActive: true },
    orderBy: { sortOrder: 'asc' }
  })
}

export async function getProductBySlug(slug: string) {
  return prisma.product.findFirst({
    where: { slug, isActive: true },
    include: { category: true, plans: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } }
  })
}

export async function getPlanById(planId: string) {
  return prisma.plan.findUnique({
    where: { id: planId },
    include: { product: { include: { category: true } } }
  })
}

export async function getAvailableStockCount(planId: string): Promise<number> {
  return prisma.stockItem.count({ where: { planId, status: 'AVAILABLE' } })
}

export async function getFullCatalog() {
  const categories = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
    include: {
      products: {
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        include: { plans: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } }
      }
    }
  })
  return categories
}
