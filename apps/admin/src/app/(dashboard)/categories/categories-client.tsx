'use client'

import { useState, type FormEvent } from 'react'
import type { Category } from '@tgshop/db'
import { upsertCategoryAction, deleteCategoryAction } from '../../../lib/actions/categories'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table'
import { Badge } from '../../../components/ui/badge'
import { t } from '../../../lib/i18n'

type CategoryWithCount = Category & { _count: { products: number } }

export function CategoriesClient({
  initialCategories,
  canEdit,
  canDelete
}: {
  initialCategories: CategoryWithCount[]
  canEdit: boolean
  canDelete: boolean
}) {
  const [categories, setCategories] = useState(initialCategories)
  const [editing, setEditing] = useState<Category | null>(null)
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [emoji, setEmoji] = useState('')
  const [sortOrder, setSortOrder] = useState(0)
  const [isActive, setIsActive] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  function resetForm() {
    setEditing(null)
    setTitle('')
    setSlug('')
    setEmoji('')
    setSortOrder(0)
    setIsActive(true)
  }

  function startEdit(category: Category) {
    setEditing(category)
    setTitle(category.title)
    setSlug(category.slug)
    setEmoji(category.emoji ?? '')
    setSortOrder(category.sortOrder)
    setIsActive(category.isActive)
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      const saved = await upsertCategoryAction({
        id: editing?.id,
        title,
        slug,
        emoji: emoji || null,
        sortOrder,
        isActive
      })
      setCategories((prev) => {
        const withCount = { ...saved, _count: { products: editing?.id ? (prev.find((c) => c.id === saved.id)?._count.products ?? 0) : 0 } }
        if (editing) {
          return prev.map((c) => (c.id === saved.id ? withCount : c))
        }
        return [...prev, withCount]
      })
      resetForm()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setPending(false)
    }
  }

  async function onDelete(id: string) {
    if (!window.confirm('Delete this category?')) return
    setError(null)
    try {
      await deleteCategoryAction(id)
      setCategories((prev) => prev.filter((c) => c.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {canEdit ? (
      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="title">Title</Label>
          <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="slug">Slug</Label>
          <Input id="slug" value={slug} onChange={(e) => setSlug(e.target.value)} required />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="emoji">Emoji</Label>
          <Input id="emoji" value={emoji} onChange={(e) => setEmoji(e.target.value)} className="w-16" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="sortOrder">Sort</Label>
          <Input
            id="sortOrder"
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(Number(e.target.value))}
            className="w-20"
          />
        </div>
        <label className="flex items-center gap-2 pb-1 text-sm">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Active
        </label>
        <Button type="submit" disabled={pending}>
          {editing ? t('common.save') : t('common.create')}
        </Button>
        {editing && (
          <Button type="button" variant="outline" onClick={resetForm}>
            {t('common.cancel')}
          </Button>
        )}
        {error && <span className="text-sm text-destructive">{error}</span>}
      </form>
      ) : (
        error && <p className="text-sm text-destructive">{error}</p>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Slug</TableHead>
            <TableHead>Products</TableHead>
            <TableHead>{t('common.status')}</TableHead>
            <TableHead>{t('common.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {categories.map((category) => (
            <TableRow key={category.id}>
              <TableCell>
                {category.emoji ? `${category.emoji} ` : ''}
                {category.title}
              </TableCell>
              <TableCell>{category.slug}</TableCell>
              <TableCell>{category._count.products}</TableCell>
              <TableCell>
                <Badge variant={category.isActive ? 'success' : 'secondary'}>
                  {category.isActive ? 'active' : 'inactive'}
                </Badge>
              </TableCell>
              <TableCell className="flex gap-2">
                {canEdit && (
                  <Button size="sm" variant="outline" onClick={() => startEdit(category)}>
                    {t('common.edit')}
                  </Button>
                )}
                {canDelete && (
                  <Button size="sm" variant="destructive" onClick={() => void onDelete(category.id)}>
                    {t('common.delete')}
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
          {categories.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                {t('common.noResults')}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
