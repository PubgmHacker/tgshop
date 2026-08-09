import { AdminRole } from '@tgshop/db'
import { listCategoriesAction } from '../../../lib/actions/categories'
import { hasRole, requireSession } from '../../../lib/rbac'
import { CategoriesClient } from './categories-client'
import { t } from '../../../lib/i18n'

export const dynamic = 'force-dynamic'

export default async function CategoriesPage() {
  const session = requireSession()

  const categories = await listCategoriesAction()

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('categories.title')}</h1>
      <CategoriesClient
        initialCategories={categories}
        canEdit={hasRole(session.role, AdminRole.ADMIN)}
        canDelete={hasRole(session.role, AdminRole.OWNER)}
      />
    </div>
  )
}
