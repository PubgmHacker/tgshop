'use client'

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { triggerHaptic } from '@/lib/TelegramProvider'

interface BottomSheetProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}

export function BottomSheet({ isOpen, onClose, title, children }: BottomSheetProps): JSX.Element | null {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  if (!isOpen || typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => {
          triggerHaptic('light')
          onClose()
        }}
      />
      <div className="relative z-10 max-h-[85vh] overflow-y-auto rounded-t-sheet bg-tg-section-bg page-enter">
        <div className="sticky top-0 flex items-center justify-between border-b border-white/5 bg-tg-section-bg px-4 py-3">
          <p className="text-base font-semibold text-tg-text">{title}</p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-tg-secondary-bg px-3 py-1 text-sm text-tg-hint"
          >
            ✕
          </button>
        </div>
        <div className="px-4 pb-8 pt-3" style={{ paddingBottom: 'calc(2rem + var(--safe-bottom))' }}>
          {children}
        </div>
      </div>
    </div>,
    document.body
  )
}
