'use client'

import { useI18n } from '@/i18n/I18nProvider'
import { useBackButton } from '@/hooks/useBackButton'
import { useMeData } from '@/hooks/useApi'
import { BalanceCard } from '@/components/BalanceCard'
import { TopupPanel } from '@/components/TopupPanel'

export default function TopupPage(): JSX.Element {
  const { t } = useI18n()
  const me = useMeData()

  useBackButton(false)

  return (
    <div className="page-enter flex flex-1 flex-col gap-5 px-4 pb-4 pt-3">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">{t('topup.title')}</h1>
      </header>

      <BalanceCard
        balanceCents={me.data?.balanceCents ?? null}
        isLoading={me.isLoading}
      />

      <TopupPanel />
    </div>
  )
}
