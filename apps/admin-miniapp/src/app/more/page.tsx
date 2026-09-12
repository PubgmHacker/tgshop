'use client'

import Link from 'next/link'
import { useI18n } from '@/i18n/I18nProvider'
import { triggerHaptic } from '@/lib/TelegramProvider'
import { Icon, type IconName } from '@/components/Icons'
import type { Locale } from '@/i18n/dictionaries'

interface MoreLink {
  href: string
  icon: IconName
  titleKey: 'more.promos' | 'more.broadcasts' | 'more.settings' | 'more.audit'
  hintKey: 'more.promos.hint' | 'more.broadcasts.hint' | 'more.settings.hint' | 'more.audit.hint'
}

const LINKS: MoreLink[] = [
  { href: '/more/promos', icon: 'star', titleKey: 'more.promos', hintKey: 'more.promos.hint' },
  { href: '/more/broadcasts', icon: 'send', titleKey: 'more.broadcasts', hintKey: 'more.broadcasts.hint' },
  { href: '/more/settings', icon: 'settings', titleKey: 'more.settings', hintKey: 'more.settings.hint' },
  { href: '/more/audit', icon: 'clock', titleKey: 'more.audit', hintKey: 'more.audit.hint' }
]

const LOCALES: Array<{ value: Locale; label: string }> = [
  { value: 'ru', label: 'Русский' },
  { value: 'en', label: 'English' }
]

export default function MorePage(): JSX.Element {
  const { t, locale, setLocale } = useI18n()

  return (
    <main className="page-enter flex flex-col gap-4 pt-2">
      <div className="mx-4 flex flex-col gap-1">
        <h1 className="text-xl font-bold tracking-[-0.02em] text-ink">{t('more.title')}</h1>
      </div>

      <div className="panel mx-4 flex flex-col divide-y divide-line rounded-card">
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            onClick={() => triggerHaptic('light')}
            className="flex items-center gap-3 p-3.5"
          >
            <span className="tile flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted">
              <Icon name={link.icon} size={17} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-ink">{t(link.titleKey)}</span>
              <span className="block truncate text-xs text-muted">{t(link.hintKey)}</span>
            </span>
            <Icon name="chevron-right" size={16} className="shrink-0 text-faint" />
          </Link>
        ))}
      </div>

      <section className="mx-4 flex flex-col gap-2.5">
        <p className="text-[13px] font-medium text-muted">{t('more.language')}</p>
        <div className="flex gap-2">
          {LOCALES.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={locale === option.value}
              onClick={() => {
                triggerHaptic('light')
                setLocale(option.value)
              }}
              className={`chip flex-1 rounded-full px-3.5 py-2.5 text-sm font-semibold ${
                locale === option.value ? 'text-ink' : 'text-faint'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>
    </main>
  )
}
