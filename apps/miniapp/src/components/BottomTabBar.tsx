'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useI18n } from '@/i18n/I18nProvider'
import { triggerHaptic } from '@/lib/TelegramProvider'

interface TabDef {
  href: string
  labelKey: 'tabs.home' | 'tabs.profile'
  icon: string
  match: (path: string) => boolean
}

const TABS: TabDef[] = [
  {
    href: '/',
    labelKey: 'tabs.home',
    icon: '🏠',
    match: (path) => path === '/' || path.startsWith('/category') || path.startsWith('/product')
  },
  {
    href: '/profile',
    labelKey: 'tabs.profile',
    icon: '👤',
    match: (path) => path.startsWith('/profile') || path.startsWith('/topup')
  }
]

export function BottomTabBar(): JSX.Element {
  const pathname = usePathname()
  const { t } = useI18n()

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-white/5 bg-tg-header-bg/95 backdrop-blur"
      style={{ paddingBottom: 'var(--safe-bottom)' }}
    >
      {TABS.map((tab) => {
        const isActive = tab.match(pathname ?? '/')
        return (
          <Link
            key={tab.href}
            href={tab.href}
            onClick={() => triggerHaptic('light')}
            className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]"
          >
            <span className={`text-xl transition-opacity ${isActive ? 'opacity-100' : 'opacity-50'}`}>
              {tab.icon}
            </span>
            <span className={isActive ? 'font-medium text-tg-text' : 'text-tg-hint'}>{t(tab.labelKey)}</span>
          </Link>
        )
      })}
    </nav>
  )
}
