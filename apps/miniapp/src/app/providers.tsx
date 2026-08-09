'use client'

import type { ReactNode } from 'react'
import { I18nProvider } from '@/i18n/I18nProvider'
import { QueryProvider } from '@/lib/QueryProvider'
import { TelegramProvider } from '@/lib/TelegramProvider'

export function Providers({ children }: { children: ReactNode }): JSX.Element {
  return (
    <TelegramProvider>
      <I18nProvider>
        <QueryProvider>{children}</QueryProvider>
      </I18nProvider>
    </TelegramProvider>
  )
}
