'use client'

import type { ReactNode } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { ApiClientError } from '@/lib/apiClient'
import { Icon } from './Icons'
import { ErrorState } from './States'

interface QueryGateProps<T> {
  data: T | undefined
  isLoading: boolean
  error: unknown
  onRetry: () => void
  skeleton: ReactNode
  children: (data: T) => ReactNode
}

/**
 * The one place every screen funnels its react-query state through: skeleton
 * while pending, a dedicated "admins only" panel on 403 (the API's requireAdmin
 * hook), a retryable error card otherwise, and the render-prop on success.
 */
export function QueryGate<T>({ data, isLoading, error, onRetry, skeleton, children }: QueryGateProps<T>): JSX.Element {
  const { t } = useI18n()

  if (isLoading) {
    return <>{skeleton}</>
  }

  if (error) {
    if (error instanceof ApiClientError && error.status === 403) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-line bg-card text-warning">
            <Icon name="shield" size={24} />
          </div>
          <p className="font-medium text-ink">{t('auth.forbidden.title')}</p>
          <p className="text-sm text-muted">{t('auth.forbidden.desc')}</p>
        </div>
      )
    }
    const message = error instanceof ApiClientError ? error.message : t('common.error.generic')
    return <ErrorState title={message} onRetry={onRetry} retryLabel={t('common.retry')} />
  }

  if (data === undefined) {
    return <>{skeleton}</>
  }

  return <>{children(data)}</>
}
