'use client'

import Link from 'next/link'
import { useI18n } from '@/i18n/I18nProvider'
import { triggerHaptic } from '@/lib/TelegramProvider'
import type { Category } from '@/types/api'

export function CategoryChip({ category }: { category: Category }): JSX.Element {
  return (
    <Link
      href={`/category/${category.slug}`}
      onClick={() => triggerHaptic('light')}
      className="flex shrink-0 items-center gap-1.5 rounded-full bg-tg-section-bg px-4 py-2 text-sm font-medium text-tg-text active:opacity-80"
    >
      {category.emoji ? <span>{category.emoji}</span> : null}
      <span>{category.title}</span>
    </Link>
  )
}

export function CategoryChipRow({ categories }: { categories: Category[] }): JSX.Element {
  const { t } = useI18n()

  if (categories.length === 0) {
    return <p className="px-4 py-2 text-sm text-tg-hint">{t('home.empty.categories')}</p>
  }

  return (
    <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-1">
      {categories.map((category) => (
        <CategoryChip key={category.id} category={category} />
      ))}
    </div>
  )
}
