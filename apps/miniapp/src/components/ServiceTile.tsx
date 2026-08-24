'use client'

import Link from 'next/link'
import { Icon } from './Icons'
import { BrandMark } from './BrandMark'
import { triggerHaptic } from '@/lib/TelegramProvider'

export function ServiceTile({
  href,
  slug,
  title,
  meta,
  featured = false
}: {
  href: string
  slug: string
  title: string
  meta: string
  featured?: boolean
}): JSX.Element {
  return (
    <Link
      href={href}
      onClick={() => triggerHaptic('light')}
      className="tile relative flex items-center gap-3 overflow-hidden rounded-[22px] px-3 py-3.5 active:scale-[0.99]"
    >
      <span className="mark-plate relative flex h-12 w-12 shrink-0 items-center justify-center rounded-[13px]">
        <BrandMark slug={slug} size={32} />
      </span>
      <span className="relative min-w-0 flex-1">
        <span className="block truncate text-[15px] font-bold leading-tight tracking-[-0.02em] text-ink">{title}</span>
        <span className="mt-0.5 block text-[13px] font-medium text-muted">{meta}</span>
      </span>
      <Icon name="chevron-right" size={16} className="relative text-muted" />
    </Link>
  )
}
