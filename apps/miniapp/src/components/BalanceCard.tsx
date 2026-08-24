'use client'

import { useI18n } from '@/i18n/I18nProvider'

interface BalanceCardProps {
  balanceCents: number | null
  tgId: string | null
  isLoading?: boolean
  compact?: boolean
}

export function BalanceCard({ balanceCents, isLoading = false }: BalanceCardProps): JSX.Element {
  const { t } = useI18n()
  const cents = balanceCents ?? 0
  const dollars = Math.trunc(cents / 100).toLocaleString('en-US')
  const fraction = String(Math.abs(cents) % 100).padStart(2, '0')

  return (
    <div className="glass glass-live overflow-hidden rounded-[28px] px-5 py-5">
      <span className="glass-sheen" aria-hidden />
      <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">{t('card.balance')}</p>
      {isLoading ? (
        <div className="skeleton mt-3 h-10 w-36 rounded-md" />
      ) : (
        <p className="tnum mt-2 text-[42px] font-bold leading-none tracking-[-0.04em] text-ink">
          ${dollars}
          <span className="text-[20px] font-medium text-muted">.{fraction}</span>
        </p>
      )}
    </div>
  )
}
