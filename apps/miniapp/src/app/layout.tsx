import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { Providers } from './providers'
import { AppHeader } from '@/components/AppHeader'
import { BottomTabBar } from '@/components/BottomTabBar'
import { BRAND_NAME } from '@/lib/tokens'
import '@/styles/globals.css'

export const metadata: Metadata = {
  title: BRAND_NAME,
  description: `${BRAND_NAME} — подписки на нейросети`
}

// The storefront HTML is the document Telegram's WebView keeps in its cache,
// and a cached copy carries the previous release's bundle. force-dynamic makes
// Next serve every document request fresh with a no-store Cache-Control.
export const dynamic = 'force-dynamic'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover'
}

export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <html lang="ru" data-theme="dark">
      <body>
        <div className="stage" aria-hidden />
        <Providers>
          <div
            className="relative z-[1] mx-auto flex min-h-[100dvh] w-full max-w-md min-w-0 flex-col overflow-x-hidden pb-36"
            style={{ paddingTop: 'var(--safe-top)' }}
          >
            <AppHeader />
            {children}
          </div>
          <BottomTabBar />
        </Providers>
        <div aria-hidden className="pointer-events-none fixed bottom-1 right-2 z-[1] text-[9px] text-faint opacity-60">
          {`v.${(process.env.RAILWAY_GIT_COMMIT_SHA ?? 'dev').slice(0, 7)}`}
        </div>
      </body>
    </html>
  )
}
