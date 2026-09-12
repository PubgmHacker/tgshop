'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useI18n } from '@/i18n/I18nProvider'
import { triggerHaptic } from '@/lib/TelegramProvider'
import { Icon, type IconName } from './Icons'

interface TabDef {
  href: string
  labelKey: 'tabs.home' | 'tabs.catalog' | 'tabs.orders' | 'tabs.balance' | 'tabs.profile'
  icon: IconName
  match: (path: string) => boolean
}

const TABS: TabDef[] = [
  { href: '/', labelKey: 'tabs.home', icon: 'home', match: (path) => path === '/' },
  {
    href: '/catalog',
    labelKey: 'tabs.catalog',
    icon: 'grid',
    match: (path) =>
      path.startsWith('/catalog') || path.startsWith('/category') || path.startsWith('/product')
  },
  {
    href: '/orders',
    labelKey: 'tabs.orders',
    icon: 'bag',
    match: (path) => path.startsWith('/orders')
  },
  {
    href: '/topup',
    labelKey: 'tabs.balance',
    icon: 'wallet',
    match: (path) => path.startsWith('/topup')
  },
  {
    href: '/profile',
    labelKey: 'tabs.profile',
    icon: 'user',
    match: (path) => path.startsWith('/profile') || path.startsWith('/settings')
  }
]

export function BottomTabBar(): JSX.Element {
  const pathname = usePathname()
  const { t } = useI18n()

  return (
    <nav
      aria-label={t('tabs.navigation')}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4"
      style={{ paddingBottom: 'calc(12px + var(--safe-bottom))' }}
    >
      <div className="glass-nav pointer-events-auto flex w-full max-w-md items-center justify-around rounded-full px-1.5 py-1.5">
        {TABS.map((tab) => {
          const isActive = tab.match(pathname ?? '/')
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => triggerHaptic('light')}
              className="flex h-[56px] w-[58px] flex-col items-center justify-end gap-0.5 pb-0.5"
            >
              <span className="flex h-10 w-10 items-center justify-center">
                <span
                  className={
                    isActive
                      ? 'tab-active flex h-10 w-10 items-center justify-center rounded-full'
                      : 'flex h-7 w-7 items-center justify-center rounded-full text-faint'
                  }
                >
                  <Icon
                    name={tab.icon}
                    size={isActive ? 22 : 16}
                    strokeWidth={isActive ? 2.1 : 1.7}
                  />
                </span>
              </span>
              <span
                className={
                  isActive
                    ? 'whitespace-nowrap text-[11px] font-bold leading-tight text-ink'
                    : 'whitespace-nowrap text-[11px] font-medium leading-tight text-faint'
                }
              >
                {t(tab.labelKey)}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
