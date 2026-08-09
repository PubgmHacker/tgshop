'use client'

import { useRouter } from 'next/navigation'
import { useI18n } from '@/i18n/I18nProvider'
import { useBackButton } from '@/hooks/useBackButton'
import { useProfileData } from '@/hooks/useApi'
import { CopyButton } from '@/components/CopyButton'
import { EmptyState, ErrorState } from '@/components/States'
import { ListRowSkeleton } from '@/components/Skeletons'
import { formatCents, formatDate } from '@/lib/format'
import { triggerHaptic } from '@/lib/TelegramProvider'
import type { OrderListItem, SubscriptionItem } from '@/types/api'

export default function ProfilePage(): JSX.Element {
  const router = useRouter()
  const { t, locale, setLocale } = useI18n()
  const { data, isLoading, isError, refetch } = useProfileData()

  useBackButton(false)

  if (isLoading) {
    return (
      <div className="page-enter flex flex-1 flex-col gap-4 pt-4">
        <div className="mx-4 skeleton h-28 rounded-card" />
        {Array.from({ length: 3 }).map((_, i) => (
          <ListRowSkeleton key={i} />
        ))}
      </div>
    )
  }

  if (isError || !data) {
    return (
      <ErrorState title={t('common.error.network')} onRetry={() => void refetch()} retryLabel={t('common.retry')} />
    )
  }

  const referralLink = `https://t.me/share/url?url=https://t.me/BRAND_NAME_bot?start=${data.user.referralCode}`

  return (
    <div className="page-enter flex flex-1 flex-col gap-5 pb-6 pt-4">
      <header className="px-4">
        <h1 className="text-xl font-bold text-tg-text">{t('profile.title')}</h1>
      </header>

      <section className="mx-4 flex items-center justify-between rounded-card bg-brand-gradient p-4">
        <div className="flex flex-col gap-0.5">
          <p className="text-xs text-white/80">{t('profile.balance')}</p>
          <p className="text-2xl font-bold text-white">{formatCents(data.user.balanceCents)}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            triggerHaptic('light')
            router.push('/topup')
          }}
          className="rounded-full bg-white/15 px-4 py-2 text-sm font-semibold text-white active:opacity-80"
        >
          {t('profile.topup')}
        </button>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="px-4 text-sm font-semibold uppercase tracking-wide text-tg-section-header-text">
          {t('profile.subscriptions')}
        </h2>
        {data.subscriptions.length === 0 ? (
          <EmptyState title={t('profile.subscriptions.empty')} />
        ) : (
          <div className="mx-4 flex flex-col gap-2">
            {data.subscriptions.map((sub) => (
              <SubscriptionRow key={sub.id} sub={sub} locale={locale} />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="px-4 text-sm font-semibold uppercase tracking-wide text-tg-section-header-text">
          {t('profile.orders')}
        </h2>
        {data.orders.length === 0 ? (
          <EmptyState title={t('profile.orders.empty')} />
        ) : (
          <div className="mx-4 flex flex-col gap-2">
            {data.orders.map((order) => (
              <OrderRow key={order.id} order={order} locale={locale} />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="px-4 text-sm font-semibold uppercase tracking-wide text-tg-section-header-text">
          {t('profile.referrals')}
        </h2>
        <div className="mx-4 flex items-center justify-between rounded-card bg-tg-section-bg p-4">
          <p className="text-sm text-tg-text">{t('profile.referrals.count', { count: data.user.referralCount })}</p>
          <CopyButton value={referralLink} label={t('profile.referrals.copyLink')} />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="px-4 text-sm font-semibold uppercase tracking-wide text-tg-section-header-text">
          {t('profile.language')}
        </h2>
        <div className="mx-4 flex gap-2">
          <button
            type="button"
            onClick={() => setLocale('ru')}
            className={`rounded-full px-4 py-2 text-sm font-medium ${
              locale === 'ru' ? 'bg-tg-button text-tg-button-text' : 'bg-tg-section-bg text-tg-text'
            }`}
          >
            RU
          </button>
          <button
            type="button"
            onClick={() => setLocale('en')}
            className={`rounded-full px-4 py-2 text-sm font-medium ${
              locale === 'en' ? 'bg-tg-button text-tg-button-text' : 'bg-tg-section-bg text-tg-text'
            }`}
          >
            EN
          </button>
        </div>
      </section>
    </div>
  )
}

function SubscriptionRow({ sub, locale }: { sub: SubscriptionItem; locale: 'ru' | 'en' }): JSX.Element {
  const { t } = useI18n()
  return (
    <div className="flex items-center justify-between rounded-card bg-tg-section-bg p-3">
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-medium text-tg-text">{sub.productTitle}</p>
        <p className="text-xs text-tg-hint">{sub.planTitle}</p>
      </div>
      <p className="text-xs text-tg-hint">
        {t('profile.subscriptions.expiresAt', { date: formatDate(sub.expiresAt, locale) })}
      </p>
    </div>
  )
}

function OrderRow({ order, locale }: { order: OrderListItem; locale: 'ru' | 'en' }): JSX.Element {
  const router = useRouter()
  const { t } = useI18n()
  return (
    <button
      type="button"
      onClick={() => {
        triggerHaptic('light')
        router.push(`/checkout/${order.id}`)
      }}
      className="flex items-center justify-between rounded-card bg-tg-section-bg p-3 text-left"
    >
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-medium text-tg-text">{order.productTitle}</p>
        <p className="text-xs text-tg-hint">{formatDate(order.createdAt, locale)}</p>
      </div>
      <div className="flex flex-col items-end gap-0.5">
        <p className="text-sm font-semibold text-tg-text">{formatCents(order.amountCents)}</p>
        <p className="text-xs text-tg-hint">{t(`order.status.${order.status}`)}</p>
      </div>
    </button>
  )
}
