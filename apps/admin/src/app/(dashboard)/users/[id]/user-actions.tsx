'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { LedgerType } from '@tgshop/db'
import { adjustBalanceAction, setUserBanAction } from '../../../../lib/actions/users'
import { Button } from '../../../../components/ui/button'
import { Input } from '../../../../components/ui/input'
import { Label } from '../../../../components/ui/label'
import { Select } from '../../../../components/ui/form'
import { formatCents } from '../../../../lib/format'
import { t } from '../../../../lib/i18n'

export function UserActions({
  userId,
  isBlocked,
  canAct
}: {
  userId: string
  isBlocked: boolean
  canAct: boolean
}) {
  const router = useRouter()
  const [amountCents, setAmountCents] = useState(0)
  const [type, setType] = useState<LedgerType>(LedgerType.ADMIN_ADJUST)
  const [comment, setComment] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  if (!canAct) {
    return <p className="text-sm text-muted-foreground">Your role cannot adjust balances or ban users.</p>
  }

  async function onAdjust() {
    if (amountCents === 0) {
      setError('Amount must be non-zero. Negative debits, positive credits.')
      return
    }
    if (!comment.trim()) {
      setError('A comment is required for every balance adjustment')
      return
    }
    setPending(true)
    setError(null)
    setMessage(null)
    try {
      // Goes through the append-only ledger (credit/debit), never a direct balance write.
      const result = await adjustBalanceAction({ userId, amountCents, type, comment })
      setMessage(`New balance: ${formatCents(result.balanceAfterCents)}`)
      setAmountCents(0)
      setComment('')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setPending(false)
    }
  }

  async function onToggleBan() {
    const next = !isBlocked
    if (!window.confirm(next ? 'Ban this user?' : 'Unban this user?')) return
    setPending(true)
    setError(null)
    setMessage(null)
    try {
      await setUserBanAction({ userId, isBlocked: next })
      setMessage(next ? 'User banned' : 'User unbanned')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="amountCents">Amount (cents)</Label>
          <Input
            id="amountCents"
            type="number"
            value={amountCents}
            onChange={(e) => setAmountCents(Math.trunc(Number(e.target.value)) || 0)}
            className="w-36"
          />
          <span className="text-xs text-muted-foreground">
            {amountCents === 0 ? 'negative = debit' : formatCents(amountCents)}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="ledgerType">Ledger type</Label>
          <Select id="ledgerType" value={type} onChange={(e) => setType(e.target.value as LedgerType)}>
            {Object.values(LedgerType).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="comment">Comment</Label>
          <Input
            id="comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="w-72"
            maxLength={500}
            required
          />
        </div>
        <Button type="button" onClick={onAdjust} disabled={pending}>
          {t('users.adjustBalance')}
        </Button>
        <Button type="button" variant={isBlocked ? 'outline' : 'destructive'} onClick={onToggleBan} disabled={pending}>
          {isBlocked ? t('users.unban') : t('users.ban')}
        </Button>
      </div>
      {message && <p className="text-sm text-success">{message}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
