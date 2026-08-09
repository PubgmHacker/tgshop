import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { Providers } from './providers'
import { BottomTabBar } from '@/components/BottomTabBar'
import { BRAND_NAME } from '@/lib/tokens'
import '@/styles/globals.css'

export const metadata: Metadata = {
  title: BRAND_NAME,
  description: `${BRAND_NAME} — digital goods store`
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
    <html lang="ru">
      <body>
        <Providers>
          <div className="mx-auto flex min-h-screen max-w-lg flex-col pb-16" style={{ paddingTop: 'var(--safe-top)' }}>
            {children}
          </div>
          <BottomTabBar />
        </Providers>
      </body>
    </html>
  )
}
