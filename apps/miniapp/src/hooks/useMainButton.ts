'use client'

import { mainButton } from '@telegram-apps/sdk-react'
import { useEffect, useRef } from 'react'
import { triggerHaptic } from '@/lib/TelegramProvider'

interface MainButtonOptions {
  text: string
  onClick: () => void
  isEnabled?: boolean
  isLoading?: boolean
  isVisible?: boolean
}

/**
 * Drives the sticky Telegram MainButton for the primary action on the current
 * screen. Falls back to an in-page button (rendered by the caller) when the
 * SDK is unavailable, e.g. during local browser development.
 */
export function useMainButton(options: MainButtonOptions): void {
  const { text, onClick, isEnabled = true, isLoading = false, isVisible = true } = options
  const onClickRef = useRef(onClick)
  onClickRef.current = onClick

  useEffect(() => {
    if (!mainButton.mount.isAvailable()) return

    try {
      mainButton.mount()
    } catch {
      // already mounted
    }

    const off = mainButton.onClick.isAvailable()
      ? mainButton.onClick(() => {
          triggerHaptic('medium')
          onClickRef.current()
        })
      : undefined

    return () => {
      off?.()
      // The button belongs to the screen that configured it. Without this a
      // sticky "Pay" / "Buy" survives navigation to a screen that never asked
      // for a MainButton and fires the previous screen's handler.
      if (mainButton.setParams.isAvailable()) {
        try {
          mainButton.setParams({ isVisible: false, isLoaderVisible: false })
        } catch {
          // unmounted by the SDK in the meantime
        }
      }
    }
  }, [])

  useEffect(() => {
    if (!mainButton.setParams.isAvailable()) return

    try {
      mainButton.setParams({
        text,
        isEnabled: isEnabled && !isLoading,
        isLoaderVisible: isLoading,
        isVisible
      })
    } catch {
      // not mounted / not in Telegram
    }
  }, [text, isEnabled, isLoading, isVisible])
}
