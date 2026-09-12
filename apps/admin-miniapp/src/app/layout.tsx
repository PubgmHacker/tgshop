import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { Providers } from './providers'
import { AppHeader } from '@/components/AppHeader'
import { BottomTabBar } from '@/components/BottomTabBar'
import { BRAND_NAME, BRAND_TAGLINE } from '@/lib/tokens'
import '@/styles/globals.css'
import '@tgshop/ui/glass-theme.css'
import { DEFAULT_THEME, THEME_INIT_SCRIPT } from '@tgshop/ui/theme'

export const metadata: Metadata = {
  title: `${BRAND_NAME} — ${BRAND_TAGLINE}`,
  description: `${BRAND_NAME} — панель управления магазином`,
  icons: { icon: '/brand/logo.png', apple: '/brand/logo.png' }
}

// Same reasoning as the customer miniapp: the WebView must never revive a
// cached document from a previous release.
export const dynamic = 'force-dynamic'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover'
}

export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <html lang="ru" data-theme={DEFAULT_THEME} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <div className="stage" aria-hidden />
        <Providers>
          <div
            className="relative z-[1] mx-auto flex min-h-screen w-full max-w-md min-w-0 flex-col overflow-x-hidden pb-36"
            style={{ paddingTop: 'var(--safe-top)' }}
          >
            <AppHeader />
            {children}
          </div>
          <BottomTabBar />
        </Providers>
      </body>
    </html>
  )
}
