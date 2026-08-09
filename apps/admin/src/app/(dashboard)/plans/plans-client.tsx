'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { upsertPlanAction, deletePlanAction } from '../../../lib/actions/plans'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { Select } from '../../../components/ui/form'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table'
import { Badge } from '../../../components/ui/badge'
import { formatCents } from '../../../lib/format'
import { t } from '../../../lib/i18n'

export interface PlanRow {
  id: string
  productId: string
  productTitle: string
  title: string
  durationDays: number | null
  priceCents: number
  priceStars: number | null
  discountPercent: number
  lowStockThreshold: number
  isActive: boolean
  sortOrder: number
  availableStock: number
}

export interface ProductOption {
  id: string
  title: string
}

export function PlansClient({
  initialPlans,
  products,
  selectedProductId,
  canEdit,
  canDelete
}: {
  initialPlans: PlanRow[]
  products: ProductOption[]
  selectedProductId: string
  canEdit: boolean
  canDelete: boolean
}) {
  const router = useRouter()
  const [plans, setPlans] = useState(initialPlans)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [productId, setProductId] = useState(selectedProductId || products[0]?.id || '')
  const [title, setTitle] = useState('')
  const [durationDays, setDurationDays] = useState('')
  const [priceCents, setPriceCents] = useState(0)
  const [priceStars, setPriceStars] = useState('')
  const [discountPercent, setDiscountPercent] = useState(0)
  const [lowStockThreshold, setLowStockThreshold] = useState(3)
  const [isActive, setIsActive] = useState(true)
  const [sortOrder, setSortOrder] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  function resetForm() {
    setEditingId(null)
    setProductId(selectedProductId || products[0]?.id || '')
    setTitle('')
    setDurationDays('')
    setPriceCents(0)
    setPriceStars('')
    setDiscountPercent(0)
    setLowStockThreshold(3)
    setIsActive(true)
    setSortOrder(0)
    setError(null)
  }

  function startEdit(plan: PlanRow) {
    setEditingId(plan.id)
    setProductId(plan.productId)
    setTitle(plan.title)
    setDurationDays(plan.durationDays === null ? '' : String(plan.durationDays))
    setPriceCents(plan.priceCents)
    setPriceStars(plan.priceStars === null ? '' : String(plan.priceStars))
    setDiscountPercent(plan.discountPercent)
    setLowStockThreshold(plan.lowStockThreshold)
    setIsActive(plan.isActive)
    setSortOrder(plan.sortOrder)
    setError(null)
  }

  function onFilterChange(value: string) {
    router.push(value ? `/plans?productId=${encodeURIComponent(value)}` : '/plans')
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      const saved = await upsertPlanAction({
        id: editingId ?? undefined,
        productId,
        title,
        durationDays: durationDays.trim() ? Math.trunc(Number(durationDays)) : null,
        priceCents,
        priceStars: priceStars.trim() ? Math.trunc(Number(priceStars)) : null,
        discountPercent,
        lowStockThreshold,
        isActive,
        sortOrder
      })
      const row: PlanRow = {
        id: saved.id,
        productId: saved.productId,
        productTitle: products.find((p) => p.id === saved.productId)?.title ?? '',
        title: saved.title,
        durationDays: saved.durationDays,
        priceCents: saved.priceCents,
        priceStars: saved.priceStars,
        discountPercent: saved.discountPercent,
        lowStockThreshold: saved.lowStockThreshold,
        isActive: saved.isActive,
        sortOrder: saved.sortOrder,
        availableStock: plans.find((p) => p.id === saved.id)?.availableStock ?? 0
      }
      setPlans((prev) => {
        if (editingId) return prev.map((p) => (p.id === row.id ? row : p))
        // A new plan for a product that is filtered out would not belong in this list.
        if (selectedProductId && row.productId !== selectedProductId) return prev
        return [...prev, row]
      })
      resetForm()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setPending(false)
    }
  }

  async function onDelete(id: string) {
    if (!window.confirm('Delete this plan? Its stock items must be removed first.')) return
    setError(null)
    try {
      await deletePlanAction(id)
      setPlans((prev) => prev.filter((p) => p.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Label htmlFor="productFilter">Filter by product</Label>
        <Select
          id="productFilter"
          value={selectedProductId}
          onChange={(e) => onFilterChange(e.target.value)}
          className="max-w-sm"
        >
          <option value="">All products</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.title}
            </option>
          ))}
        </Select>
      </div>

      {canEdit ? (
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 rounded-lg border border-border p-4 md:grid-cols-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="planProduct">Product</Label>
            <Select id="planProduct" value={productId} onChange={(e) => setProductId(e.target.value)} required>
              {products.length === 0 && <option value="">— no products yet —</option>}
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.title}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="planTitle">Title</Label>
            <Input id="planTitle" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="durationDays">Duration (days)</Label>
            <Input
              id="durationDays"
              type="number"
              min={1}
              value={durationDays}
              onChange={(e) => setDurationDays(e.target.value)}
              placeholder="empty = one-off"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="priceCents">Price (cents)</Label>
            <Input
              id="priceCents"
              type="number"
              min={0}
              value={priceCents}
              onChange={(e) => setPriceCents(Math.max(0, Math.trunc(Number(e.target.value)) || 0))}
              required
            />
            <span className="text-xs text-muted-foreground">= {formatCents(priceCents)}</span>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="priceStars">Price (Stars override)</Label>
            <Input
              id="priceStars"
              type="number"
              min={0}
              value={priceStars}
              onChange={(e) => setPriceStars(e.target.value)}
              placeholder="empty = derive from rate"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="discountPercent">Discount %</Label>
            <Input
              id="discountPercent"
              type="number"
              min={0}
              max={100}
              value={discountPercent}
              onChange={(e) => setDiscountPercent(Math.min(100, Math.max(0, Math.trunc(Number(e.target.value)) || 0)))}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="lowStockThreshold">Low-stock threshold</Label>
            <Input
              id="lowStockThreshold"
              type="number"
              min={0}
              value={lowStockThreshold}
              onChange={(e) => setLowStockThreshold(Math.max(0, Math.trunc(Number(e.target.value)) || 0))}
            />
          </div>
          <div className="flex items-end gap-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="planSort">Sort</Label>
              <Input
                id="planSort"
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(Math.trunc(Number(e.target.value)) || 0)}
                className="w-24"
              />
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              Active
            </label>
          </div>
          <div className="flex items-center gap-3 md:col-span-3">
            <Button type="submit" disabled={pending || products.length === 0}>
              {editingId ? t('common.save') : t('common.create')}
            </Button>
            {editingId && (
              <Button type="button" variant="outline" onClick={resetForm}>
                {t('common.cancel')}
              </Button>
            )}
            {error && <span className="text-sm text-destructive">{error}</span>}
          </div>
        </form>
      ) : (
        error && <p className="text-sm text-destructive">{error}</p>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Plan</TableHead>
            <TableHead>Product</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead>Price</TableHead>
            <TableHead>Stars</TableHead>
            <TableHead>Discount</TableHead>
            <TableHead>{t('stock.available')}</TableHead>
            <TableHead>{t('common.status')}</TableHead>
            <TableHead>{t('common.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {plans.map((plan) => (
            <TableRow key={plan.id}>
              <TableCell className="font-medium">{plan.title}</TableCell>
              <TableCell>{plan.productTitle}</TableCell>
              <TableCell className="tabular-nums">{plan.durationDays === null ? '—' : `${plan.durationDays}d`}</TableCell>
              <TableCell className="tabular-nums">{formatCents(plan.priceCents)}</TableCell>
              <TableCell className="tabular-nums">{plan.priceStars === null ? '—' : plan.priceStars}</TableCell>
              <TableCell className="tabular-nums">{plan.discountPercent}%</TableCell>
              <TableCell className="tabular-nums">
                <Badge variant={plan.availableStock <= plan.lowStockThreshold ? 'destructive' : 'success'}>
                  {plan.availableStock}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge variant={plan.isActive ? 'success' : 'secondary'}>{plan.isActive ? 'active' : 'inactive'}</Badge>
              </TableCell>
              <TableCell className="flex gap-2">
                {canEdit && (
                  <Button size="sm" variant="outline" onClick={() => startEdit(plan)}>
                    {t('common.edit')}
                  </Button>
                )}
                {canDelete && (
                  <Button size="sm" variant="destructive" onClick={() => onDelete(plan.id)}>
                    {t('common.delete')}
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
          {plans.length === 0 && (
            <TableRow>
              <TableCell colSpan={9} className="text-center text-muted-foreground">
                {t('common.noResults')}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
