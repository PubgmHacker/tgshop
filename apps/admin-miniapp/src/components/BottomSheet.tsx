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
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => {
          triggerHaptic('light')
          onClose()
        }}
      />
      <div className="page-enter relative z-10 mx-auto max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-sheet border-t border-line bg-card">
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-line-strong" />
        <div className="sticky top-0 flex items-center justify-between bg-card px-5 py-3">
          <p className="text-base font-bold text-ink">{title}</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-card-strong text-muted"
          >
            ✕
          </button>
        </div>
        <div className="px-5 pb-8 pt-2" style={{ paddingBottom: 'calc(2rem + var(--safe-bottom))' }}>
          {children}
        </div>
      </div>
    </div>,
    document.body
  )
}
