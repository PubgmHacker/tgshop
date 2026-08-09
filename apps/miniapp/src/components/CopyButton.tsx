'use client'

import { useState } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { triggerHaptic, triggerNotificationHaptic } from '@/lib/TelegramProvider'

interface CopyButtonProps {
  value: string
  label?: string
}

export function CopyButton({ value, label }: CopyButtonProps): JSX.Element {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      triggerNotificationHaptic('success')
      setTimeout(() => setCopied(false), 1600)
    } catch {
      triggerNotificationHaptic('error')
    }
  }

  return (
    <button
      type="button"
      onClick={() => {
        triggerHaptic('light')
        void handleCopy()
      }}
      className="shrink-0 rounded-full bg-tg-secondary-bg px-3 py-1.5 text-xs font-medium text-tg-text active:opacity-70"
    >
      {copied ? t('common.copied') : label ?? t('common.copy')}
    </button>
  )
}
