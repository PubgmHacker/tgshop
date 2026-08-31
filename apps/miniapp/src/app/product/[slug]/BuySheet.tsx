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

export function BuySheet({
  isOpen,
  onClose,
  plan,
  onProceedToCheckout
}: BuySheetProps): JSX.Element {
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
        <div className="flex items-center justify-between rounded-card border border-line bg-card-strong px-4 py-3">
          <p className="text-sm font-medium text-ink">{plan.title}</p>
          <p className="tnum text-sm font-bold text-ink">{formatCents(plan.priceCents)}</p>
        </div>

        <div className="flex items-center justify-between">
          <p className="text-sm text-muted">{t('buySheet.qty')}</p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => adjustQty(-1)}
              aria-label={t('buySheet.qty.decrease')}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-card-strong text-lg text-ink"
            >
              −
            </button>
            <span className="tnum w-6 text-center text-sm font-semibold text-ink">{qty}</span>
            <button
              type="button"
              onClick={() => adjustQty(1)}
              aria-label={t('buySheet.qty.increase')}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-card-strong text-lg text-ink"
            >
              +
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <p className="text-sm text-muted">{t('buySheet.promo')}</p>
          <div className="flex gap-2">
            <input
              value={promoCode}
              onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
              aria-label={t('buySheet.promo')}
              placeholder="PROMO2026"
              className="min-w-0 flex-1 rounded-xl border border-line bg-card-strong px-3.5 py-2.5 text-sm text-ink outline-none placeholder:text-faint"
            />
            <button
              type="button"
              onClick={() => void handleApplyPromo()}
              disabled={previewMutation.isPending}
              className="shrink-0 rounded-xl border border-line-strong px-3.5 py-2.5 text-sm font-semibold text-ink disabled:opacity-50"
            >
              {t('buySheet.promoApply')}
            </button>
          </div>
          {promoError ? <p className="text-xs text-danger">{promoError}</p> : null}
          {breakdown?.promoCode ? (
            <p className="text-xs font-medium text-success">{t('buySheet.promoApplied')}</p>
          ) : null}
        </div>

        <div className="flex items-center justify-between border-t border-line pt-3.5">
          <p className="text-sm font-semibold text-ink">{t('buySheet.total')}</p>
          <p className="tnum text-lg font-bold text-ink">{formatCents(totalCents)}</p>
        </div>

        <button
          type="button"
          onClick={handleCheckout}
          disabled={previewMutation.isPending}
          className="rounded-full bg-cta py-3.5 text-center text-sm font-semibold text-cta-ink disabled:opacity-50"
        >
          {t('buySheet.checkout')}
        </button>
      </div>
    </BottomSheet>
  )
}
