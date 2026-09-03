'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { useTheme } from '@/lib/ThemeProvider'
import { useI18n } from '@/i18n/I18nProvider'
import { triggerHaptic, useTelegram } from '@/lib/TelegramProvider'
import { BRAND_NAME, BRAND_TAGLINE } from '@/lib/tokens'
import { Icon } from './Icons'

function isInnerRoute(path: string): boolean {
  return (
    path.startsWith('/product/') ||
    path.startsWith('/category/') ||
    path.startsWith('/settings') ||
    path.startsWith('/checkout')
  )
}

function fallbackFor(path: string): string {
  if (path.startsWith('/product/') || path.startsWith('/category/')) return '/catalog'
  if (path.startsWith('/settings')) return '/profile'
  if (path.startsWith('/checkout')) return '/orders'
  return '/'
}

export function AppHeader(): JSX.Element {
  const { theme, toggleTheme } = useTheme()
  const { t } = useI18n()
  const pathname = usePathname()
  const router = useRouter()
  const { isTelegramEnvironment } = useTelegram()
  // Inside Telegram the native BackButton (useBackButton) owns navigation; a second chevron would duplicate it.
  const showBack = isInnerRoute(pathname ?? '/') && !isTelegramEnvironment

  return (
    <header className="flex items-center justify-between px-4 pb-2 pt-3">
      {showBack ? (
        <button
          type="button"
          aria-label={t('common.back')}
          onClick={() => {
            triggerHaptic('light')
            if (typeof window !== 'undefined' && window.history.length > 1) {
              router.back()
              return
            }
            router.push(fallbackFor(pathname ?? '/'))
          }}
          className="chip relative inline-flex items-center gap-1 rounded-full px-3 py-2 text-[14px] font-semibold text-ink"
        >
          <Icon name="chevron-left" size={18} />
          {t('common.back')}
        </button>
      ) : (
        <Link href="/" onClick={() => triggerHaptic('light')} className="flex items-center gap-3">
          <span className="flex h-10 w-10 overflow-hidden rounded-full">
            <Image
              src="/brand/logo.png"
              alt=""
              width={40}
              height={40}
              className="h-10 w-10 object-cover"
            />
          </span>
          <span className="flex flex-col">
            <span className="whitespace-nowrap text-[15px] font-bold leading-none tracking-[-0.03em] text-ink">
              {BRAND_NAME}
            </span>
            <span className="mt-1 text-[12px] font-medium text-muted">{BRAND_TAGLINE}</span>
          </span>
        </Link>
      )}
      <button
        type="button"
        aria-label={t('settings.theme.toggle')}
        onClick={() => {
          triggerHaptic('light')
          toggleTheme()
        }}
        className="tile flex h-11 w-11 items-center justify-center rounded-full text-muted active:opacity-80"
      >
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
      </button>
    </header>
  )
}
