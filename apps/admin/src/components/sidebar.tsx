'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '../lib/cn'
import { t } from '../lib/i18n'

const NAV_ITEMS: Array<{ href: string; key: Parameters<typeof t>[0] }> = [
  { href: '/', key: 'nav.dashboard' },
  { href: '/categories', key: 'nav.categories' },
  { href: '/products', key: 'nav.products' },
  { href: '/plans', key: 'nav.plans' },
  { href: '/stock', key: 'nav.stock' },
  { href: '/orders', key: 'nav.orders' },
  { href: '/users', key: 'nav.users' },
  { href: '/promos', key: 'nav.promos' },
  { href: '/broadcasts', key: 'nav.broadcasts' },
  { href: '/settings', key: 'nav.settings' }
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <nav aria-label="Разделы управления" className="shrink-0 border-b border-border bg-card p-3 md:w-56 md:border-b-0 md:border-r">
      <div className="mb-3 px-2 text-lg font-semibold">Управление магазином</div>
      <div className="flex gap-1 overflow-x-auto md:sticky md:top-3 md:flex-col">
      {NAV_ITEMS.map((item) => {
        const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors',
              active ? 'bg-primary text-primary-foreground' : 'text-foreground/80 hover:bg-accent hover:text-accent-foreground'
            )}
          >
            {t(item.key)}
          </Link>
        )
      })}
      </div>
    </nav>
  )
}
