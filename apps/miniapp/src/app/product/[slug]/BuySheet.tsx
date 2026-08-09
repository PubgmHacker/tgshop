'use client'

import { useState } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { BottomSheet } from '@/components/BottomSheet'
import { usePricingPreview } from '@/hooks/useApi'
import { formatCents } from '@/lib/format'
import { triggerHaptic, triggerNotificationHaptic } from '@/lib/TelegramProvider'
import type { Plan } from '@/types/api'

interface BuySheetProps {
  isOpen: boolean
  onClose: () => void
  plan: Plan
  onProceedToCheckout: (params: { planId: string; qty: number; promoCode: string | null }) => void
}

export function BuySheet({ isOpen, onClose, plan, onProceedToCheckout }: BuySheetProps): JSX.Element {
  const { t } = useI18n()
  const [qty, setQty] = useState(1)
  const [promoCode, setPromoCode] = useState('')
  const [promoError, setPromoError] = useState<string | null>(null)
  const previewMutation = usePricingPreview()

  const unitTotal = plan.priceCents * (100 - plan.discountPercent)
  const fallbackTotal = Math.round(unitTotal / 100) * qty
  const breakdown = previewMutation.data
  const totalCents = breakdown?.totalCents ?? fallbackTotal

  function adjustQty(delta: number): void {
    triggerHaptic('light')
    setQty((prev) => Math.max(1, Math.min(99, prev + delta)))
  }

  async function handleApplyPromo(): Promise<void> {
    if (!promoCode.trim()) return
    setPromoError(null)
    try {
      await previewMutation.mutateAsync({ planId: plan.id, qty, promoCode: promoCode.trim() })
      triggerNotificationHaptic('success')
    } catch {
      setPromoError(t('buySheet.promoInvalid'))
      triggerNotificationHaptic('error')
    }
  }

  function handleCheckout(): void {
    triggerHaptic('medium')
    onProceedToCheckout({ planId: plan.id, qty, promoCode: promoCode.trim() || null })
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={t('buySheet.title')}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-tg-text">{plan.title}</p>
          <p className="text-sm font-semibold text-tg-text">{formatCents(plan.priceCents)}</p>
        </div>

        <div className="flex items-center justify-between">
          <p className="text-sm text-tg-hint">{t('buySheet.qty')}</p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => adjustQty(-1)}
              className="h-8 w-8 rounded-full bg-tg-secondary-bg text-tg-text"
            >
              −
            </button>
            <span className="w-6 text-center text-sm font-medium text-tg-text">{qty}</span>
            <button
              type="button"
              onClick={() => adjustQty(1)}
              className="h-8 w-8 rounded-full bg-tg-secondary-bg text-tg-text"
            >
              +
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <p className="text-sm text-tg-hint">{t('buySheet.promo')}</p>
          <div className="flex gap-2">
            <input
              value={promoCode}
              onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
              placeholder="PROMO2026"
              className="flex-1 rounded-lg bg-tg-secondary-bg px-3 py-2 text-sm text-tg-text outline-none placeholder:text-tg-hint"
            />
            <button
              type="button"
              onClick={() => void handleApplyPromo()}
              disabled={previewMutation.isPending}
              className="shrink-0 rounded-lg bg-tg-secondary-bg px-3 py-2 text-sm font-medium text-tg-text disabled:opacity-50"
            >
              {t('buySheet.promoApply')}
            </button>
          </div>
          {promoError ? <p className="text-xs text-tg-destructive">{promoError}</p> : null}
          {breakdown?.promoCode ? (
            <p className="text-xs text-tg-accent-text">{t('buySheet.promoApplied')}</p>
          ) : null}
        </div>

        <div className="flex items-center justify-between border-t border-white/5 pt-3">
          <p className="text-sm font-semibold text-tg-text">{t('buySheet.total')}</p>
          <p className="text-base font-bold text-tg-text">{formatCents(totalCents)}</p>
        </div>

        <button
          type="button"
          onClick={handleCheckout}
          disabled={previewMutation.isPending}
          className="w-full rounded-full bg-tg-button py-3 text-center text-sm font-semibold text-tg-button-text disabled:opacity-50"
        >
          {t('buySheet.checkout')}
        </button>
      </div>
    </BottomSheet>
  )
}
