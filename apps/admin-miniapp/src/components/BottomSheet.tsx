'use client'

import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { triggerHaptic } from '@/lib/TelegramProvider'
import { useI18n } from '@/i18n/I18nProvider'
import { Icon } from './Icons'

interface BottomSheetProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}

export function BottomSheet({
  isOpen,
  onClose,
  title,
  children
}: BottomSheetProps): JSX.Element | null {
  const { t } = useI18n()
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  const titleId = useId()
  onCloseRef.current = onClose

  useEffect(() => {
    if (!isOpen) return

    const previousOverflow = document.body.style.overflow
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.body.style.overflow = 'hidden'
    const background = Array.from(document.body.children)
      .filter((node): node is HTMLElement => node instanceof HTMLElement && !node.contains(dialogRef.current))
      .map((node) => ({ node, inert: node.inert }))
    for (const { node } of background) node.inert = true

    const focusables = (): HTMLElement[] =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled])'
        ) ?? []
      )

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 0)

    return () => {
      window.clearTimeout(focusTimer)
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      for (const { node, inert } of background) node.inert = inert
      restoreFocusRef.current?.focus()
      restoreFocusRef.current = null
    }
  }, [isOpen])

  if (!isOpen || typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        aria-hidden="true"
        onClick={() => {
          triggerHaptic('light')
          onClose()
        }}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="page-enter relative z-10 mx-auto max-h-[85vh] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-sheet border-t border-line bg-card"
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-line-strong" />
        <div className="sticky top-0 flex items-center justify-between bg-card px-5 py-3">
          <h2 id={titleId} className="text-base font-bold text-ink">
            {title}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-card-strong text-muted"
          >
            <Icon name="close" size={17} />
          </button>
        </div>
        <div
          className="px-5 pb-8 pt-2"
          style={{ paddingBottom: 'calc(2rem + var(--safe-bottom))' }}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body
  )
}
