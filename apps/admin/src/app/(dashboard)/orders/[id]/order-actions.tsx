'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { redeliverOrderAction, refundOrderAction } from '../../../../lib/actions/orders'
import { Button } from '../../../../components/ui/button'
import { Input } from '../../../../components/ui/input'
import { Label } from '../../../../components/ui/label'
import { t } from '../../../../lib/i18n'

export function OrderActions({
  orderId,
  canAct,
  canRedeliver,
  canRefund
}: {
  orderId: string
  canAct: boolean
  canRedeliver: boolean
  canRefund: boolean
}) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  if (!canAct) {
    return <p className="text-sm text-muted-foreground">Your role cannot re-deliver or refund orders.</p>
  }

  async function onRedeliver() {
    if (!window.confirm('Re-send the stored payload to this user?')) return
    setPending(true)
    setError(null)
    setMessage(null)
    try {
      await redeliverOrderAction({ orderId })
      setMessage('Order re-delivered')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setPending(false)
    }
  }

  async function onRefund() {
    if (!reason.trim()) {
      setError('A refund reason is required')
      return
    }
    if (!window.confirm('Refund this order? The amount is credited to the user ledger.')) return
    setPending(true)
    setError(null)
    setMessage(null)
    try {
      const result = await refundOrderAction({ orderId, reason })
      setMessage(`Refunded. New balance: ${result.ledgerResult.balanceAfterCents} cents`)
      setReason('')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Button type="button" variant="outline" onClick={onRedeliver} disabled={pending || !canRedeliver}>
          {t('orders.redeliver')}
        </Button>
        <div className="flex flex-col gap-1">
          <Label htmlFor="refundReason">Refund reason</Label>
          <Input
            id="refundReason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-72"
            maxLength={500}
          />
        </div>
        <Button type="button" variant="destructive" onClick={onRefund} disabled={pending || !canRefund}>
          {t('orders.refund')}
        </Button>
      </div>
      {!canRedeliver && (
        <p className="text-xs text-muted-foreground">
          Re-delivery only applies to PAID / DELIVERED / FAILED orders that still have a stored payload.
        </p>
      )}
      {!canRefund && <p className="text-xs text-muted-foreground">This order is already refunded.</p>}
      {message && <p className="text-sm text-success">{message}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
