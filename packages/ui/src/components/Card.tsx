import type { HTMLAttributes } from 'react'
import clsx from 'clsx'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padded?: boolean
  interactive?: boolean
}

/** Generic surface container: rounded, subtle border/shadow, neutral background. */
export function Card({ padded = true, interactive = false, className, children, ...rest }: CardProps) {
  return (
    <div
      className={clsx(
        'rounded-lg border border-neutral-200 bg-neutral-0 shadow-sm dark:border-neutral-700 dark:bg-neutral-900',
        padded && 'p-4',
        interactive && 'transition-shadow duration-200 hover:shadow-md cursor-pointer',
        className
      )}
      {...rest}
    >
      {children}
    </div>
  )
}
