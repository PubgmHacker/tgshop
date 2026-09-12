'use client'

import { useI18n } from '@/i18n/I18nProvider'
import type { ProductPromotion } from '@/types/api'

export function ProductBadges({ promotion }: { promotion?: ProductPromotion | null }): JSX.Element | null {
  const { t } = useI18n()
  if (!promotion) return null
  return (
    <span className="flex flex-wrap gap-1.5 text-[11px] font-semibold leading-4">
      {promotion.isNew ? <span className="chip rounded-full px-2.5 py-1 text-ink">{t('promotion.new')}</span> : null}
      {promotion.featured ? <span className="rounded-full bg-cta px-2.5 py-1 text-cta-ink">{t('promotion.featured')}</span> : null}
      {promotion.limited ? <span className="chip rounded-full px-2.5 py-1 text-ink">{t('promotion.limited')}</span> : null}
    </span>
  )
}
