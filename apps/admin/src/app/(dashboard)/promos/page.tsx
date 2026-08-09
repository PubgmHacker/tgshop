import { AdminRole } from '@tgshop/db'
import { listPromosAction } from '../../../lib/actions/promos'
import { listPlansAction } from '../../../lib/actions/plans'
import { hasRole, requireSession } from '../../../lib/rbac'
import { PromosClient, type PlanOption, type PromoRow } from './promos-client'
import { t } from '../../../lib/i18n'

export const dynamic = 'force-dynamic'

export default async function PromosPage() {
  const session = requireSession()

  const [promos, plans] = await Promise.all([listPromosAction(), listPlansAction()])

  const planOptions: PlanOption[] = plans.map((plan) => ({
    id: plan.id,
    title: `${plan.product.title} / ${plan.title}`
  }))
  const planLabels = new Map(planOptions.map((plan) => [plan.id, plan.title]))

  const rows: PromoRow[] = promos.map((promo) => ({
    id: promo.id,
    code: promo.code,
    type: promo.type,
    value: promo.value,
    maxUses: promo.maxUses,
    usedCount: promo.usedCount,
    expiresAt: promo.expiresAt ? promo.expiresAt.toISOString() : null,
    planId: promo.planId,
    planTitle: promo.planId ? (planLabels.get(promo.planId) ?? promo.plan?.title ?? null) : null,
    isActive: promo.isActive
  }))

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('promos.title')}</h1>
      <PromosClient
        initialPromos={rows}
        plans={planOptions}
        canEdit={hasRole(session.role, AdminRole.ADMIN)}
        canDelete={hasRole(session.role, AdminRole.OWNER)}
      />
    </div>
  )
}
