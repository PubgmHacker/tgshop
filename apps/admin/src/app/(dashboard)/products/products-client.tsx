'use client'

import { useState, type FormEvent } from 'react'
import type { DeliveryType } from '@tgshop/db'
import { upsertProductAction, deleteProductAction } from '../../../lib/actions/products'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { Select, Textarea } from '../../../components/ui/form'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table'
import { Badge } from '../../../components/ui/badge'
import { formatJson } from '../../../lib/format'
import { t } from '../../../lib/i18n'

export interface ProductRow {
  id: string
  categoryId: string
  categoryTitle: string
  title: string
  slug: string
  description: string
  imageUrl: string | null
  deliveryType: DeliveryType
  externalConfig: unknown
  isActive: boolean
  sortOrder: number
  planCount: number
}

export interface CategoryOption {
  id: string
  title: string
}

export function ProductsClient({
  initialProducts,
  categories,
  deliveryTypes,
  canEdit,
  canDelete
}: {
  initialProducts: ProductRow[]
  categories: CategoryOption[]
  deliveryTypes: DeliveryType[]
  canEdit: boolean
  canDelete: boolean
}) {
  const [products, setProducts] = useState(initialProducts)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [deliveryType, setDeliveryType] = useState<DeliveryType>(deliveryTypes[0] ?? 'STOCK_POOL')
  const [externalConfigText, setExternalConfigText] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [sortOrder, setSortOrder] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  function resetForm() {
    setEditingId(null)
    setCategoryId(categories[0]?.id ?? '')
    setTitle('')
    setSlug('')
    setDescription('')
    setImageUrl('')
    setDeliveryType(deliveryTypes[0] ?? 'STOCK_POOL')
    setExternalConfigText('')
    setIsActive(true)
    setSortOrder(0)
    setError(null)
  }

  function startEdit(product: ProductRow) {
    setEditingId(product.id)
    setCategoryId(product.categoryId)
    setTitle(product.title)
    setSlug(product.slug)
    setDescription(product.description)
    setImageUrl(product.imageUrl ?? '')
    setDeliveryType(product.deliveryType)
    setExternalConfigText(product.externalConfig ? formatJson(product.externalConfig) : '')
    setIsActive(product.isActive)
    setSortOrder(product.sortOrder)
    setError(null)
  }

  /** Parses the JSON editor contents; empty means "no config". Must be a plain object. */
  function readExternalConfig(): Record<string, unknown> | null {
    const raw = externalConfigText.trim()
    if (!raw) return null
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error('externalConfig is not valid JSON')
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('externalConfig must be a JSON object')
    }
    return parsed as Record<string, unknown>
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      const saved = await upsertProductAction({
        id: editingId ?? undefined,
        categoryId,
        title,
        slug,
        description,
        imageUrl: imageUrl.trim() || null,
        deliveryType,
        externalConfig: readExternalConfig(),
        isActive,
        sortOrder
      })
      const row: ProductRow = {
        id: saved.id,
        categoryId: saved.categoryId,
        categoryTitle: categories.find((c) => c.id === saved.categoryId)?.title ?? '',
        title: saved.title,
        slug: saved.slug,
        description: saved.description,
        imageUrl: saved.imageUrl,
        deliveryType: saved.deliveryType,
        externalConfig: saved.externalConfig,
        isActive: saved.isActive,
        sortOrder: saved.sortOrder,
        planCount: products.find((p) => p.id === saved.id)?.planCount ?? 0
      }
      setProducts((prev) => (editingId ? prev.map((p) => (p.id === row.id ? row : p)) : [...prev, row]))
      resetForm()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setPending(false)
    }
  }

  async function onDelete(id: string) {
    if (!window.confirm('Delete this product? Its plans and stock must be removed first.')) return
    setError(null)
    try {
      await deleteProductAction(id)
      setProducts((prev) => prev.filter((p) => p.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {canEdit ? (
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 rounded-lg border border-border p-4 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="title">Title</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="slug">Slug</Label>
            <Input
              id="slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              required
              pattern="[a-z0-9-]+"
              title="lowercase letters, digits and dashes"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="categoryId">Category</Label>
            <Select id="categoryId" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
              {categories.length === 0 && <option value="">— no categories yet —</option>}
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.title}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="deliveryType">Delivery type</Label>
            <Select
              id="deliveryType"
              value={deliveryType}
              onChange={(e) => setDeliveryType(e.target.value as DeliveryType)}
            >
              {deliveryTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1 md:col-span-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              className="min-h-[80px]"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="imageUrl">Image URL</Label>
            <Input
              id="imageUrl"
              type="url"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://…"
            />
          </div>
          <div className="flex items-end gap-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="sortOrder">Sort</Label>
              <Input
                id="sortOrder"
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
          <div className="flex flex-col gap-1 md:col-span-2">
            <Label htmlFor="externalConfig">
              externalConfig (JSON, used by EXTERNAL_API delivery)
            </Label>
            <Textarea
              id="externalConfig"
              value={externalConfigText}
              onChange={(e) => setExternalConfigText(e.target.value)}
              spellCheck={false}
              placeholder='{ "endpoint": "https://…", "apiKeyRef": "…" }'
              className="font-mono text-xs"
            />
          </div>
          <div className="flex items-center gap-3 md:col-span-2">
            <Button type="submit" disabled={pending || categories.length === 0}>
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
            <TableHead>Title</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Delivery</TableHead>
            <TableHead>Plans</TableHead>
            <TableHead>Sort</TableHead>
            <TableHead>{t('common.status')}</TableHead>
            <TableHead>{t('common.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((product) => (
            <TableRow key={product.id}>
              <TableCell>
                <div className="font-medium">{product.title}</div>
                <div className="text-xs text-muted-foreground">{product.slug}</div>
              </TableCell>
              <TableCell>{product.categoryTitle}</TableCell>
              <TableCell>
                <Badge variant={product.deliveryType === 'MANUAL_FALLBACK' ? 'warning' : 'secondary'}>
                  {product.deliveryType}
                </Badge>
              </TableCell>
              <TableCell className="tabular-nums">
                <a className="underline underline-offset-4" href={`/plans?productId=${product.id}`}>
                  {product.planCount}
                </a>
              </TableCell>
              <TableCell className="tabular-nums">{product.sortOrder}</TableCell>
              <TableCell>
                <Badge variant={product.isActive ? 'success' : 'secondary'}>
                  {product.isActive ? 'active' : 'inactive'}
                </Badge>
              </TableCell>
              <TableCell className="flex gap-2">
                {canEdit && (
                  <Button size="sm" variant="outline" onClick={() => startEdit(product)}>
                    {t('common.edit')}
                  </Button>
                )}
                {canDelete && (
                  <Button size="sm" variant="destructive" onClick={() => onDelete(product.id)}>
                    {t('common.delete')}
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
          {products.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground">
                {t('common.noResults')}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
