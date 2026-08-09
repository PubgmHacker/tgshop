import type { HTMLAttributes } from 'react'
import clsx from 'clsx'

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  width?: string | number
  height?: string | number
  circle?: boolean
}

/** Loading placeholder block with a subtle pulse animation. */
export function Skeleton({ width, height = '1rem', circle = false, className, style, ...rest }: SkeletonProps) {
  return (
    <div
      className={clsx(
        'animate-pulse bg-neutral-200 dark:bg-neutral-700',
        circle ? 'rounded-full' : 'rounded-md',
        className
      )}
      style={{ width, height, ...style }}
      aria-hidden
      {...rest}
    />
  )
}
