'use client'

import { useI18n } from '@/i18n/I18nProvider'
import { EmptyState } from '@/components/States'

export default function NotFound(): JSX.Element {
  const { t } = useI18n()
  return (
    <div className="flex flex-1 items-center justify-center">
      <EmptyState icon="search" title={t('common.notFound')} />
    </div>
  )
}
