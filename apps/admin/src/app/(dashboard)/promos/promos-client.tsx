'use client'

import { useState, type FormEvent } from 'react'
import { PromoType } from '@tgshop/db'
import { upsertPromoAction, deletePromoAction } from '../../../lib/actions/promos'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { Select } from '../../../components/ui/form'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table'
import { Badge } from '../../../components/ui/badge'
import { formatEnum, formatCents, formatDate, fromDateTimeLocalValue, toDateTimeLocalValue } from '../../../lib/format'
import { t } from '../../../lib/i18n'

export interface PromoRow {
  id: string
  code: string
  type: PromoType
  value: number
  maxUses: number | null
  usedCount: number
  expiresAt: string | null
  planId: string | null
  planTitle: string | null
  isActive: boolean
}

export interface PlanOption {
  id: string
  title: string
}

export function PromosClient({
  initialPromos,
  plans,
  canEdit,
  canDelete
}: {
  initialPromos: PromoRow[]
  plans: PlanOption[]
  canEdit: boolean
  canDelete: boolean
}) {
  const [promos, setPromos] = useState(initialPromos)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [type, setType] = useState<PromoType>(PromoType.PERCENT)
  const [value, setValue] = useState(0)
  const [maxUses, setMaxUses] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [planId, setPlanId] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  function resetForm() {
    setEditingId(null)
    setCode('')
    setType(PromoType.PERCENT)
    setValue(0)
    setMaxUses('')
    setExpiresAt('')
    setPlanId('')
    setIsActive(true)
    setError(null)
  }

  function startEdit(promo: PromoRow) {
    setEditingId(promo.id)
    setCode(promo.code)
    setType(promo.type)
    setValue(promo.value)
    setMaxUses(promo.maxUses === null ? '' : String(promo.maxUses))
    setExpiresAt(toDateTimeLocalValue(promo.expiresAt))
    setPlanId(promo.planId ?? '')
    setIsActive(promo.isActive)
    setError(null)
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      const saved = await upsertPromoAction({
        id: editingId ?? undefined,
        code,
        type,
        value,
        maxUses: maxUses.trim() ? Math.trunc(Number(maxUses)) : null,
        expiresAt: fromDateTimeLocalValue(expiresAt),
        planId: planId || null,
        isActive
      })
      const row: PromoRow = {
        id: saved.id,
        code: saved.code,
        type: saved.type,
        value: saved.value,
        maxUses: saved.maxUses,
        usedCount: saved.usedCount,
        expiresAt: saved.expiresAt ? saved.expiresAt.toISOString() : null,
        planId: saved.planId,
        planTitle: plans.find((plan) => plan.id === saved.planId)?.title ?? null,
        isActive: saved.isActive
      }
      setPromos((prev) => (editingId ? prev.map((p) => (p.id === row.id ? row : p)) : [...prev, row]))
      resetForm()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось выполнить действие. Повторите попытку.')
    } finally {
      setPending(false)
    }
  }

  async function onDelete(id: string) {
    if (!window.confirm('Delete this promo code?')) return
    setError(null)
    try {
      await deletePromoAction(id)
      setPromos((prev) => prev.filter((promo) => promo.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось выполнить действие. Повторите попытку.')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {canEdit ? (
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 rounded-lg border border-border p-4 md:grid-cols-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="code">Промокод</Label>
            <Input
              id="code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              required
              pattern="[A-Z0-9_-]{3,64}"
              title="От 3 до 64 заглавных латинских букв, цифр, дефисов или подчёркиваний"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="type">Тип</Label>
            <Select id="type" value={type} onChange={(e) => setType(e.target.value as PromoType)}>
              {Object.values(PromoType).map((option) => (
                <option key={option} value={option}>
                  {formatEnum(option)}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="value">{type === PromoType.PERCENT ? 'Скидка (%)' : 'Скидка (центы USD)'}</Label>
            <Input
              id="value"
              type="number"
              min={0}
              max={type === PromoType.PERCENT ? 100 : undefined}
              value={value}
              onChange={(e) => setValue(Math.max(0, Math.trunc(Number(e.target.value)) || 0))}
              required
            />
            <span className="text-xs text-muted-foreground">
              {type === PromoType.PERCENT ? `Скидка ${value}%` : `Скидка ${formatCents(value)}`}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="maxUses">Лимит применений</Label>
            <Input
              id="maxUses"
              type="number"
              min={1}
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              placeholder="пусто — без лимита"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="expiresAt">Действует до (UTC)</Label>
            <Input
              id="expiresAt"
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="planId">Применяется к тарифу</Label>
            <Select id="planId" value={planId} onChange={(e) => setPlanId(e.target.value)}>
              <option value="">Любой тариф</option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.title}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-wrap items-center gap-3 md:col-span-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              Активен
            </label>
            <Button type="submit" disabled={pending}>
              {editingId ? t('common.save') : t('common.create')}
            </Button>
            {editingId && (
              <Button type="button" variant="outline" onClick={resetForm}>
                {t('common.cancel')}
              </Button>
            )}
            {error && <span role="alert" className="text-sm text-destructive">{error}</span>}
          </div>
        </form>
      ) : (
        error && <p role="alert" className="text-sm text-destructive">{error}</p>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Промокод</TableHead>
            <TableHead>Тип</TableHead>
            <TableHead>Значение</TableHead>
            <TableHead>Использовано</TableHead>
            <TableHead>Действует до</TableHead>
            <TableHead>Тариф</TableHead>
            <TableHead>{t('common.status')}</TableHead>
            <TableHead>{t('common.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {promos.map((promo) => {
            const exhausted = promo.maxUses !== null && promo.usedCount >= promo.maxUses
            return (
              <TableRow key={promo.id}>
                <TableCell className="font-mono font-medium">{promo.code}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{formatEnum(promo.type)}</Badge>
                </TableCell>
                <TableCell className="tabular-nums">
                  {promo.type === PromoType.PERCENT ? `${promo.value}%` : formatCents(promo.value)}
                </TableCell>
                <TableCell className="tabular-nums">
                  <Badge variant={exhausted ? 'destructive' : 'secondary'}>
                    {promo.usedCount} / {promo.maxUses ?? '∞'}
                  </Badge>
                </TableCell>
                <TableCell>{formatDate(promo.expiresAt)}</TableCell>
                <TableCell>{promo.planTitle ?? 'Любой'}</TableCell>
                <TableCell>
                  <Badge variant={promo.isActive ? 'success' : 'secondary'}>
                    {promo.isActive ? 'Активен' : 'Отключён'}
                  </Badge>
                </TableCell>
                <TableCell className="flex gap-2">
                  {canEdit && (
                    <Button size="sm" variant="outline" onClick={() => startEdit(promo)}>
                      {t('common.edit')}
                    </Button>
                  )}
                  {canDelete && (
                    <Button size="sm" variant="destructive" onClick={() => onDelete(promo.id)}>
                      {t('common.delete')}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
          {promos.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-muted-foreground">
                {t('common.noResults')}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
