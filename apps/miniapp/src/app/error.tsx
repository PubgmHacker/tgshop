'use client'

import { useEffect } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { ErrorState } from '@/components/States'

export default function RouteError({ error, reset }: { error: Error; reset: () => void }): JSX.Element {
  const { t } = useI18n()
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(error)
  }, [error])

  return (
    <div className="flex flex-1 items-center justify-center">
      <ErrorState title={t('common.error.generic')} onRetry={reset} retryLabel={t('common.retry')} />
    </div>
  )
}
