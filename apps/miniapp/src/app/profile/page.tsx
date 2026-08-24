'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { useBackButton } from '@/hooks/useBackButton'
import { useMeData, useProfileData } from '@/hooks/useApi'
import { Icon } from '@/components/Icons'
import { ErrorState } from '@/components/States'
import { formatCents } from '@/lib/format'
import { triggerHaptic } from '@/lib/TelegramProvider'

export default function ProfilePage(): JSX.Element {
  const { t } = useI18n()
  const me = useMeData()
  const profile = useProfileData()
  const [copied, setCopied] = useState(false)

  useBackButton(false)

  if (me.isError && profile.isError) {
    return (
      <ErrorState
        title={t('common.error.network')}
        onRetry={() => {
          void me.refetch()
          void profile.refetch()
        }}
        retryLabel={t('common.retry')}
      />
    )
  }

  const displayName = me.data?.user.username ?? me.data?.user.firstName ?? '—'
  const referralLink = me.data?.referral.link ?? ''

  async function copyReferral(): Promise<void> {
    if (!referralLink) return
    triggerHaptic('light')
    try {
      await navigator.clipboard.writeText(referralLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 1_600)
    } catch {
      // Clipboard unavailable — the link stays visible.
    }
  }

  return (
    <div className="page-enter flex flex-1 flex-col gap-4 px-4 pb-4 pt-3">
      <section className="glass glass-live overflow-hidden rounded-[28px] px-5 py-5">
        <span className="glass-sheen" aria-hidden />
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">{t('profile.title')}</p>
        <h1 className="mt-2 text-[28px] font-bold tracking-[-0.03em] text-ink">
          {me.isLoading ? '—' : displayName}
        </h1>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="chip rounded-full px-3 py-1.5 text-[12px] text-muted">
            {t('card.balance')} {formatCents(me.data?.balanceCents ?? 0)}
          </span>
          <span className="chip rounded-full px-3 py-1.5 text-[12px] text-muted">
            {t('profile.orders')} {profile.data?.orders.length ?? 0}
          </span>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <Link
            href="/topup"
            onClick={() => triggerHaptic('light')}
            className="btn-primary rounded-full py-3 text-center text-[14px] font-bold"
          >
            {t('profile.topup')}
          </Link>
          <Link
            href="/orders"
            onClick={() => triggerHaptic('light')}
            className="btn-ghost rounded-full py-3 text-center text-[14px] font-bold"
          >
            {t('home.action.orders')}
          </Link>
        </div>
      </section>

      <section className="tile rounded-[22px] px-4 py-4">
        <p className="text-[13px] font-medium text-muted">{t('profile.referrals')}</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div>
            <p className="text-[11px] text-faint">{t('profile.referrals.invited')}</p>
            <p className="tnum mt-1 text-lg font-semibold text-ink">{me.data?.referral.count ?? 0}</p>
          </div>
          <div>
            <p className="text-[11px] text-faint">{t('profile.referrals.earned')}</p>
            <p className="tnum mt-1 text-lg font-semibold text-ink">{formatCents(me.data?.referral.earningsCents ?? 0)}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void copyReferral()}
          className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-full bg-card-strong py-2.5 text-[13px] font-semibold text-ink ring-1 ring-line"
        >
          <Icon name={copied ? 'check' : 'copy'} size={14} />
          {copied ? t('common.copied') : t('profile.referrals.copyLink')}
        </button>
      </section>

      <Link
        href="/settings"
        onClick={() => triggerHaptic('light')}
        className="tile flex items-center justify-between rounded-[22px] px-4 py-4"
      >
        <span className="text-[15px] font-semibold text-ink">{t('settings.title')}</span>
        <Icon name="chevron-right" size={16} className="text-faint" />
      </Link>
    </div>
  )
}
