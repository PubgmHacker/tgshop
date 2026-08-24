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

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover'
}

export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <html lang="ru" data-theme="dark">
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
