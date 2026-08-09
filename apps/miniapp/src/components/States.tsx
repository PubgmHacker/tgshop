'use client'

interface EmptyStateProps {
  icon?: string
  title: string
  description?: string
}

export function EmptyState({ icon = '📦', title, description }: EmptyStateProps): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <div className="text-4xl">{icon}</div>
      <p className="text-tg-text font-medium">{title}</p>
      {description ? <p className="text-sm text-tg-hint">{description}</p> : null}
    </div>
  )
}

interface ErrorStateProps {
  title: string
  onRetry?: () => void
  retryLabel?: string
}

export function ErrorState({ title, onRetry, retryLabel = 'Retry' }: ErrorStateProps): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="text-4xl">⚠️</div>
      <p className="text-tg-text font-medium">{title}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-full bg-tg-button px-5 py-2 text-sm font-medium text-tg-button-text active:opacity-80"
        >
          {retryLabel}
        </button>
      ) : null}
    </div>
  )
}
