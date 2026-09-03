'use client'

import { useI18n } from '@/i18n/I18nProvider'
import { formatCents } from '@/lib/format'

interface BalanceCardProps {
  balanceCents: number | null
  isLoading?: boolean
}

export function BalanceCard({ balanceCents, isLoading = false }: BalanceCardProps): JSX.Element {
  const { t } = useI18n()
  // Same formatter as every other money label, split only for the typographic emphasis.
  const display = formatCents(balanceCents ?? 0)
  const dot = display.lastIndexOf('.')
  const whole = dot >= 0 ? display.slice(0, dot) : display
  const fraction = dot >= 0 ? display.slice(dot) : ''

  return (
    <div className="glass glass-live overflow-hidden rounded-[28px] px-5 py-5">
      <span className="glass-sheen" aria-hidden />
      <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">{t('card.balance')}</p>
      {isLoading ? (
        <div className="skeleton mt-3 h-10 w-36 rounded-md" aria-busy />
      ) : (
        <p className="tnum mt-2 text-[42px] font-bold leading-none tracking-[-0.04em] text-ink" aria-label={`${t('card.balance')}: ${display}`}>
          {whole}
          {fraction ? <span className="text-[20px] font-medium text-muted">{fraction}</span> : null}
        </p>
      )}
    </div>
  )
}
