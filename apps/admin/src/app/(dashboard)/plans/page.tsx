import { AdminRole } from '@tgshop/db'
import { listPlansAction } from '../../../lib/actions/plans'
import { listProductsAction } from '../../../lib/actions/products'
import { hasRole, requireSession } from '../../../lib/rbac'
import { PlansClient, type PlanRow } from './plans-client'
import { t } from '../../../lib/i18n'

export const dynamic = 'force-dynamic'

export default async function PlansPage({
  searchParams: searchParamsPromise
}: {
  searchParams: Promise<{ productId?: string | string[] }>
}) {
  const session = await requireSession()
  const searchParams = await searchParamsPromise
  const raw = searchParams.productId
  const productId = Array.isArray(raw) ? raw[0] : raw

  const [plans, products] = await Promise.all([listPlansAction(productId || undefined), listProductsAction()])

  const rows: PlanRow[] = plans.map((plan) => ({
    id: plan.id,
    productId: plan.productId,
    productTitle: plan.product.title,
    title: plan.title,
    durationDays: plan.durationDays,
    priceCents: plan.priceCents,
    priceStars: plan.priceStars,
    discountPercent: plan.discountPercent,
    lowStockThreshold: plan.lowStockThreshold,
    isActive: plan.isActive,
    sortOrder: plan.sortOrder,
    availableStock: plan._count.stockItems
  }))

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('plans.title')}</h1>
      {/* key remounts the client on filter change so its local row state is rebuilt from the server data */}
      <PlansClient
        key={productId ?? 'all'}
        initialPlans={rows}
        products={products.map((product) => ({ id: product.id, title: product.title }))}
        selectedProductId={productId ?? ''}
        canEdit={hasRole(session.role, AdminRole.ADMIN)}
        canDelete={hasRole(session.role, AdminRole.OWNER)}
      />
    </div>
  )
}
