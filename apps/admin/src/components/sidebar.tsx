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
    <nav className="flex w-56 shrink-0 flex-col gap-1 border-r border-border bg-card p-3">
      <div className="mb-4 px-2 text-lg font-semibold">tgshop admin</div>
      {NAV_ITEMS.map((item) => {
        const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'rounded-md px-3 py-2 text-sm font-medium transition-colors',
              active ? 'bg-primary text-primary-foreground' : 'text-foreground/80 hover:bg-accent hover:text-accent-foreground'
            )}
          >
            {t(item.key)}
          </Link>
        )
      })}
    </nav>
  )
}
