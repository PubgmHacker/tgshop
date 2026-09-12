'use client'

import Link from 'next/link'
import { Icon } from './Icons'
import { BrandMark } from './BrandMark'
import { triggerHaptic } from '@/lib/TelegramProvider'
import { useI18n } from '@/i18n/I18nProvider'
import type { ProductPromotion } from '@/types/api'
import { ProductBadges } from './ProductBadges'

export function ServiceTile({
  href,
  slug,
  title,
  meta,
  promotion
}: {
  href: string
  slug: string
  title: string
  meta: string
  promotion?: ProductPromotion | null
}): JSX.Element {
  const { locale, t } = useI18n()
  return (
    <Link
      href={href}
      onClick={() => triggerHaptic('light')}
      className={`${promotion?.featured ? 'glass glass-live' : 'tile'} relative flex items-center gap-3 overflow-hidden rounded-[22px] px-3 py-3.5 active:scale-[0.99]`}
    >
      <span className="mark-plate relative flex h-12 w-12 shrink-0 items-center justify-center rounded-[13px]">
        <BrandMark slug={slug} size={32} />
      </span>
      <span className="relative min-w-0 flex-1">
        <span className="block break-words text-[15px] font-bold leading-tight tracking-[-0.02em] text-ink">{title}</span>
        {promotion ? <span className="mt-2 block"><ProductBadges promotion={promotion} /></span> : null}
        {promotion?.featured ? <span className="mt-2 block text-[13px] leading-relaxed text-muted">{promotion.summary[locale]}</span> : null}
        <span className="mt-0.5 block text-[13px] font-medium text-muted">{meta}</span>
        {promotion?.limited ? <span className="mt-1 block text-xs leading-relaxed text-muted">{t('promotion.inviteAccess')}</span> : null}
      </span>
      <Icon name="chevron-right" size={16} className="relative shrink-0 text-muted" />
    </Link>
  )
}
