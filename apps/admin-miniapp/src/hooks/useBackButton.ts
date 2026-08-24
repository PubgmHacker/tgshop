'use client'

import { backButton } from '@telegram-apps/sdk-react'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Wires Telegram's hardware/UI BackButton to the Next.js router. Shows the
 * button on any screen deeper than the root tab and pops the router stack.
 */
export function useBackButton(enabled: boolean): void {
  const router = useRouter()

  useEffect(() => {
    if (!backButton.mount.isAvailable() && !backButton.show.isAvailable()) return

    if (enabled) {
      try {
        backButton.show()
      } catch {
        // not mounted / not in Telegram
      }
    } else {
      try {
        backButton.hide()
      } catch {
        // not mounted / not in Telegram
      }
    }

    const offClick = backButton.onClick.isAvailable()
      ? backButton.onClick(() => {
          router.back()
        })
      : undefined

    return () => {
      offClick?.()
    }
  }, [enabled, router])
}
