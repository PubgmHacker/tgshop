'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { StockStatus } from '@tgshop/db'
import {
  bulkPasteStockAction,
  csvImportStockAction,
  deleteStockItemAction
} from '../../../lib/actions/stock'
import { Button } from '../../../components/ui/button'
import { Label } from '../../../components/ui/label'
import { Select, Textarea } from '../../../components/ui/form'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table'
import { Badge } from '../../../components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { formatEnum, formatDateTime } from '../../../lib/format'
import { t } from '../../../lib/i18n'

export interface PlanStockSummary {
  planId: string
  planTitle: string
  productTitle: string
  available: number
  reserved: number
  sold: number
  lowStockThreshold: number
}

export interface StockItemRow {
  id: string
  status: StockStatus
  createdAt: string
  orderId: string | null
  reservedUntil: string | null
}

export function StockClient({
  summaries,
  items,
  selectedPlanId,
  canImport,
  canDelete
}: {
  summaries: PlanStockSummary[]
  items: StockItemRow[]
  selectedPlanId: string
  canImport: boolean
  canDelete: boolean
}) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState(items)
  const [paste, setPaste] = useState('')
  const [csv, setCsv] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const pasteLineCount = paste.split('\n').filter((line) => line.trim().length > 0).length
  const csvLineCount = csv.split('\n').filter((line) => line.trim().length > 0).length

  function onPlanChange(value: string) {
    router.push(value ? `/stock?planId=${encodeURIComponent(value)}` : '/stock')
  }

  async function onBulkPaste(event: FormEvent) {
    event.preventDefault()
    if (!selectedPlanId) {
      setError('Сначала выберите тариф')
      return
    }
    setPending(true)
    setError(null)
    setMessage(null)
    try {
      // The raw textarea text goes to the server as-is: the schema splits and
      // trims lines there, and each payload is encrypted server-side. Plaintext
      // never round-trips back to the browser.
      const result = await bulkPasteStockAction({ planId: selectedPlanId, payloads: paste })
      setMessage(`Загружено позиций: ${result.createdCount}`)
      setPaste('')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось выполнить действие. Повторите попытку.')
    } finally {
      setPending(false)
    }
  }

  async function onCsvImport(event: FormEvent) {
    event.preventDefault()
    if (!selectedPlanId) {
      setError('Сначала выберите тариф')
      return
    }
    setPending(true)
    setError(null)
    setMessage(null)
    try {
      const result = await csvImportStockAction({ planId: selectedPlanId, csv })
      setMessage(`Загружено позиций из CSV: ${result.createdCount}`)
      setCsv('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось выполнить действие. Повторите попытку.')
    } finally {
      setPending(false)
    }
  }

  async function onFilePicked(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setError(null)
    try {
      setCsv(await file.text())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось прочитать файл')
    }
  }

  async function onDelete(id: string) {
    if (!window.confirm('Удалить позицию склада?')) return
    setError(null)
    try {
      await deleteStockItemAction(id)
      setRows((prev) => prev.filter((row) => row.id !== id))
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось выполнить действие. Повторите попытку.')
    }
  }

  const selected = summaries.find((summary) => summary.planId === selectedPlanId)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Label htmlFor="planPicker">Тариф</Label>
        <Select
          id="planPicker"
          value={selectedPlanId}
          onChange={(e) => onPlanChange(e.target.value)}
          className="max-w-lg"
        >
          <option value="">— выберите тариф —</option>
          {summaries.map((summary) => (
            <option key={summary.planId} value={summary.planId}>
              {summary.productTitle} / {summary.planTitle} (доступно: {summary.available})
            </option>
          ))}
        </Select>
      </div>

      {selected && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>{t('stock.available')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className={
                  selected.available <= selected.lowStockThreshold
                    ? 'text-2xl font-semibold tabular-nums text-destructive'
                    : 'text-2xl font-semibold tabular-nums text-success'
                }
              >
                {selected.available}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">минимум: {selected.lowStockThreshold}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('stock.reserved')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tabular-nums">{selected.reserved}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('stock.sold')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tabular-nums">{selected.sold}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {message && <p role="status" className="text-sm text-success">{message}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {canImport && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <form onSubmit={onBulkPaste} className="flex flex-col gap-3 rounded-lg border border-border p-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="bulkPaste">{t('stock.bulkPaste')}</Label>
              <span className="text-xs text-muted-foreground">
                Одна позиция на строку. Данные шифруются перед сохранением.
              </span>
              <Textarea
                id="bulkPaste"
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
                spellCheck={false}
                className="font-mono text-xs"
                placeholder={'ABCD-1234-EFGH\nIJKL-5678-MNOP'}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={pending || !selectedPlanId || pasteLineCount === 0}>
                Загрузить позиций: {pasteLineCount}
              </Button>
            </div>
          </form>

          <form onSubmit={onCsvImport} className="flex flex-col gap-3 rounded-lg border border-border p-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="csvFile">{t('stock.csvImport')}</Label>
              <span className="text-xs text-muted-foreground">
                Одна позиция на строку. Первая строка с заголовком payload, code или value пропускается.
              </span>
              <input
                ref={fileInputRef}
                id="csvFile"
                type="file"
                accept=".csv,text/csv,text/plain"
                onChange={onFilePicked}
                className="text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-transparent file:px-3 file:py-1 file:text-sm"
              />
              <Textarea
                id="csvText"
                aria-label="Содержимое CSV"
                value={csv}
                onChange={(e) => setCsv(e.target.value)}
                spellCheck={false}
                className="mt-2 font-mono text-xs"
                placeholder="payload&#10;ABCD-1234-EFGH"
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={pending || !selectedPlanId || csvLineCount === 0}>
                Загрузить CSV ({csvLineCount})
              </Button>
            </div>
          </form>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Остатки по тарифам</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Товар / тариф</TableHead>
                <TableHead>{t('stock.available')}</TableHead>
                <TableHead>{t('stock.reserved')}</TableHead>
                <TableHead>{t('stock.sold')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summaries.map((summary) => (
                <TableRow key={summary.planId}>
                  <TableCell>
                    <button
                      type="button"
                      className="underline underline-offset-4"
                      onClick={() => onPlanChange(summary.planId)}
                    >
                      {summary.productTitle} / {summary.planTitle}
                    </button>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    <Badge variant={summary.available <= summary.lowStockThreshold ? 'destructive' : 'success'}>
                      {summary.available}
                    </Badge>
                  </TableCell>
                  <TableCell className="tabular-nums">{summary.reserved}</TableCell>
                  <TableCell className="tabular-nums">{summary.sold}</TableCell>
                </TableRow>
              ))}
              {summaries.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    {t('common.noResults')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {selectedPlanId && (
        <Card>
          <CardHeader>
            <CardTitle>Последние 500 позиций тарифа</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>{t('common.status')}</TableHead>
                  <TableHead>Заказ</TableHead>
                  <TableHead>Резерв до (UTC)</TableHead>
                  <TableHead>Создано (UTC)</TableHead>
                  <TableHead>{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">{row.id}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(row.status)}>{formatEnum(row.status)}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.orderId ? (
                        <a className="underline underline-offset-4" href={`/orders/${row.orderId}`}>
                          {row.orderId}
                        </a>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>{formatDateTime(row.reservedUntil)}</TableCell>
                    <TableCell>{formatDateTime(row.createdAt)}</TableCell>
                    <TableCell>
                      {canDelete && row.status === StockStatus.AVAILABLE && (
                        <Button size="sm" variant="destructive" onClick={() => onDelete(row.id)}>
                          {t('common.delete')}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      {t('common.noResults')}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function statusVariant(status: StockStatus): 'success' | 'warning' | 'secondary' {
  if (status === StockStatus.AVAILABLE) return 'success'
  if (status === StockStatus.RESERVED) return 'warning'
  return 'secondary'
}
