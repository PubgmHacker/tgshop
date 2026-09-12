'use client'

import Link from 'next/link'
import { useI18n } from '@/i18n/I18nProvider'
import { formatCents } from '@/lib/format'
import { triggerHaptic } from '@/lib/TelegramProvider'

export function HomeHero({
  balanceCents,
  isLoading = false
}: {
  balanceCents: number | null
  isLoading?: boolean
}): JSX.Element {
  const { t } = useI18n()
  const cents = balanceCents ?? 0

  return (
    <section className="glass glass-live welcome-panel overflow-hidden rounded-[28px] px-5 py-6" aria-labelledby="welcome-title">
      <span className="glass-sheen" aria-hidden />
      <p className="chip relative inline-flex rounded-full px-2.5 py-1 text-[12px] font-semibold text-ink">
        {t('card.balance')} · {isLoading ? '—' : formatCents(cents)}
      </p>
      <h1 id="welcome-title" className="relative mt-4 text-[30px] font-bold leading-[1.12] tracking-[-0.03em] text-ink">
        {t('home.hero.title')}
      </h1>
      <p className="relative mt-3 text-[15px] leading-relaxed text-muted">{t('home.hero.sub')}</p>
      <div className="relative mt-5 grid grid-cols-2 gap-2">
        <Link
          href="/catalog"
          onClick={() => triggerHaptic('light')}
          className="btn-primary rounded-full py-3.5 text-center text-[14px] font-bold active:opacity-80"
        >
          {t('home.hero.catalog')}
        </Link>
        <Link
          href="/orders"
          onClick={() => triggerHaptic('light')}
          className="btn-ghost rounded-full py-3.5 text-center text-[14px] font-bold active:opacity-80"
        >
          {t('home.hero.orders')}
        </Link>
      </div>
    </section>
  )
}
