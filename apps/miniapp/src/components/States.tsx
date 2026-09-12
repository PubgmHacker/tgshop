'use client'

import { useI18n } from '@/i18n/I18nProvider'
import { Icon, type IconName } from './Icons'

interface EmptyStateProps {
  icon?: IconName
  title: string
  description?: string
}

export function EmptyState({ icon = 'box', title, description }: EmptyStateProps): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-line bg-card text-faint">
        <Icon name={icon} size={24} />
      </div>
      <p className="font-medium text-ink">{title}</p>
      {description ? <p className="text-sm text-muted">{description}</p> : null}
    </div>
  )
}

interface ErrorStateProps {
  title: string
  onRetry?: () => void
  retryLabel?: string
  actionHref?: string
  actionLabel?: string
}

export function ErrorState({ title, onRetry, retryLabel, actionHref, actionLabel }: ErrorStateProps): JSX.Element {
  const { t } = useI18n()
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-line bg-card text-danger">
        <Icon name="alert" size={24} />
      </div>
      <p className="font-medium text-ink">{title}</p>
      {actionHref && actionLabel ? (
        <a href={actionHref} className="btn-primary min-h-11 rounded-full px-5 py-2.5 text-sm font-semibold">
          {actionLabel}
        </a>
      ) : onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="flex items-center gap-2 rounded-full bg-cta px-5 py-2.5 text-sm font-semibold text-cta-ink active:opacity-80"
        >
          <Icon name="refresh" size={15} />
          {retryLabel ?? t('common.retry')}
        </button>
      ) : null}
    </div>
  )
}
