import type { HTMLAttributes } from 'react'
import clsx from 'clsx'

export type BadgeTone = 'accent' | 'neutral' | 'success' | 'warning' | 'danger' | 'info'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
}

const toneClasses: Record<BadgeTone, string> = {
  accent: 'bg-accent-100 text-accent-700 dark:bg-accent-900/40 dark:text-accent-200',
  neutral: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200',
  success: 'bg-success-500/15 text-success-600',
  warning: 'bg-warning-500/15 text-warning-600',
  danger: 'bg-danger-500/15 text-danger-600',
  info: 'bg-info-500/15 text-info-600'
}

/** Small pill label for statuses (order status, stock status, plan tags, etc). */
export function Badge({ tone = 'neutral', className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium leading-5',
        toneClasses[tone],
        className
      )}
      {...rest}
    >
      {children}
    </span>
  )
}
