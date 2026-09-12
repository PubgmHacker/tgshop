import { AdminRole, StockStatus } from '@tgshop/db'
import { listStockAction, stockSummaryAction } from '../../../lib/actions/stock'
import { listPlansAction } from '../../../lib/actions/plans'
import { hasRole, requireSession } from '../../../lib/rbac'
import { StockClient, type PlanStockSummary, type StockItemRow } from './stock-client'
import { t } from '../../../lib/i18n'

export const dynamic = 'force-dynamic'

export default async function StockPage({ searchParams: searchParamsPromise }: { searchParams: Promise<{ planId?: string | string[] }> }) {
  const session = await requireSession()
  const searchParams = await searchParamsPromise
  const raw = searchParams.planId
  const planId = Array.isArray(raw) ? raw[0] : raw

  const [plans, grouped, items] = await Promise.all([
    listPlansAction(),
    stockSummaryAction(),
    planId ? listStockAction(planId) : Promise.resolve([])
  ])

  // grouped is [{ planId, status, _count: { _all } }] — fold it into per-plan totals.
  const counts = new Map<string, { available: number; reserved: number; sold: number }>()
  for (const row of grouped) {
    const entry = counts.get(row.planId) ?? { available: 0, reserved: 0, sold: 0 }
    if (row.status === StockStatus.AVAILABLE) entry.available += row._count._all
    else if (row.status === StockStatus.RESERVED) entry.reserved += row._count._all
    else if (row.status === StockStatus.SOLD) entry.sold += row._count._all
    counts.set(row.planId, entry)
  }

  const selectedPlanId = plans.some((plan) => plan.id === planId && plan.usesStock) ? planId : undefined
  const summaries: PlanStockSummary[] = plans.filter((plan) => plan.usesStock).map((plan) => {
    const entry = counts.get(plan.id) ?? { available: 0, reserved: 0, sold: 0 }
    return {
      planId: plan.id,
      planTitle: plan.title,
      productTitle: plan.product.title,
      available: entry.available,
      reserved: entry.reserved,
      sold: entry.sold,
      lowStockThreshold: plan.lowStockThreshold
    }
  })

  const rows: StockItemRow[] = (selectedPlanId ? items : []).map((item) => ({
    id: item.id,
    status: item.status,
    createdAt: item.createdAt.toISOString(),
    orderId: item.orderId,
    reservedUntil: item.reservedUntil ? item.reservedUntil.toISOString() : null
  }))

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('stock.title')}</h1>
      {planId && !selectedPlanId && <p className="text-sm text-muted-foreground">Для этого тарифа склад не используется или тариф недоступен. Выберите тариф с выдачей со склада.</p>}
      {/* key remounts the client when the plan filter changes so its row state matches the server data */}
      <StockClient
        key={selectedPlanId ?? 'none'}
        summaries={summaries}
        items={rows}
        selectedPlanId={selectedPlanId ?? ''}
        canImport={hasRole(session.role, AdminRole.ADMIN)}
        canDelete={hasRole(session.role, AdminRole.OWNER)}
      />
    </div>
  )
}
