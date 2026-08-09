import { AdminRole, DeliveryType } from '@tgshop/db'
import { listProductsAction } from '../../../lib/actions/products'
import { listCategoriesAction } from '../../../lib/actions/categories'
import { hasRole, requireSession } from '../../../lib/rbac'
import { ProductsClient, type ProductRow } from './products-client'
import { t } from '../../../lib/i18n'

export const dynamic = 'force-dynamic'

export default async function ProductsPage() {
  const session = requireSession()
  const [products, categories] = await Promise.all([listProductsAction(), listCategoriesAction()])

  const rows: ProductRow[] = products.map((product) => ({
    id: product.id,
    categoryId: product.categoryId,
    categoryTitle: product.category.title,
    title: product.title,
    slug: product.slug,
    description: product.description,
    imageUrl: product.imageUrl,
    deliveryType: product.deliveryType,
    externalConfig: product.externalConfig,
    isActive: product.isActive,
    sortOrder: product.sortOrder,
    planCount: product._count.plans
  }))

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('products.title')}</h1>
      <ProductsClient
        initialProducts={rows}
        categories={categories.map((category) => ({ id: category.id, title: category.title }))}
        deliveryTypes={Object.values(DeliveryType)}
        canEdit={hasRole(session.role, AdminRole.ADMIN)}
        canDelete={hasRole(session.role, AdminRole.OWNER)}
      />
    </div>
  )
}
