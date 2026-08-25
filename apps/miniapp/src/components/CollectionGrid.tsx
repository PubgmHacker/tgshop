'use client'

import Link from 'next/link'
import { useI18n } from '@/i18n/I18nProvider'
import { triggerHaptic } from '@/lib/TelegramProvider'
import { Icon, type IconName } from './Icons'
import type { Category } from '@/types/api'

const CATEGORY_ICON: Record<string, IconName> = {
  chat: 'user',
  image: 'star',
  code: 'code'
}

export function CollectionGrid({
  categories,
  counts,
  isLoading = false
}: {
  categories: Category[]
  counts: Record<string, number>
  isLoading?: boolean
}): JSX.Element {
  const { t } = useI18n()

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-2.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton h-[120px] rounded-[24px]" />
        ))}
      </div>
    )
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[16px] font-bold tracking-[-0.02em] text-ink">{t('home.collections')}</h2>
      <div className="grid grid-cols-2 gap-2.5">
        <Link
          href="/catalog"
          onClick={() => triggerHaptic('light')}
          className="tile relative flex h-[120px] flex-col justify-between overflow-hidden rounded-[24px] p-4 active:scale-[0.99]"
        >
          <span className="mark-plate relative flex h-10 w-10 items-center justify-center rounded-[11px]">
            <Icon name="grid" size={20} className="text-black" />
          </span>
          <span className="relative">
            <span className="block text-[16px] font-bold tracking-[-0.02em] text-ink">{t('home.collections.all')}</span>
            <span className="mt-0.5 block text-[13px] font-medium text-muted">{t('catalog.title')}</span>
          </span>
        </Link>
        {categories.length === 0 ? (
          <div className="tile relative flex h-[120px] flex-col justify-between overflow-hidden rounded-[24px] p-4">
            <span className="mark-plate relative flex h-10 w-10 items-center justify-center rounded-[11px]">
              <Icon name="box" size={20} className="text-black" />
            </span>
            <span className="relative">
              <span className="block text-[16px] font-bold tracking-[-0.02em] text-ink">
                {t('home.collections.soon')}
              </span>
              <span className="mt-0.5 block text-[13px] font-medium text-muted">
                {t('home.collections.soon.sub')}
              </span>
            </span>
          </div>
        ) : null}
        {categories.map((category) => {
          return (
            <Link
              key={category.id}
              href={`/catalog?cat=${encodeURIComponent(category.slug)}`}
              onClick={() => triggerHaptic('light')}
              className="tile relative flex h-[120px] flex-col justify-between overflow-hidden rounded-[24px] p-4 active:scale-[0.99]"
            >
              <span className="mark-plate relative flex h-10 w-10 items-center justify-center rounded-[11px]">
                <Icon name={CATEGORY_ICON[category.slug] ?? 'grid'} size={20} className="text-black" />
              </span>
              <span className="relative">
                <span className="block text-[16px] font-bold tracking-[-0.02em] text-ink">{category.title}</span>
                <span className="mt-0.5 block text-[13px] font-medium text-muted">
                  {t('catalog.positions', { count: counts[category.slug] ?? 0 })}
                </span>
              </span>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
