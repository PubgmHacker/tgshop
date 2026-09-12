'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { upsertSettingAction, deleteSettingAction } from '../../../lib/actions/settings'
import type { SettingKind } from '../../../lib/schemas'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { Select, Textarea } from '../../../components/ui/form'
import { Badge } from '../../../components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { formatDateTime } from '../../../lib/format'
import { t } from '../../../lib/i18n'

export interface SettingRow {
  key: string
  label: string
  kind: SettingKind
  hint: string
  /** The Json value already flattened to the text shape the editor works with. */
  editable: string
  updatedAt: string | null
  /** True for keys described in SETTING_DEFINITIONS; false for free-form ones. */
  known: boolean
  /** False when the key has no row in the DB yet. */
  exists: boolean
}

/**
 * Mirrors `settingKindSchemas` in lib/schemas.ts so a bad value is caught before
 * the round-trip. The server re-validates through parseSettingValue() — this is
 * a convenience, never the authority.
 */
function toValue(kind: SettingKind, raw: string): unknown {
  const trimmed = raw.trim()
  switch (kind) {
    case 'int': {
      const parsed = Number(trimmed)
      if (!Number.isInteger(parsed) || parsed < 0) throw new Error('Введите целое число от 0')
      return parsed
    }
    case 'percent': {
      const parsed = Number(trimmed)
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) throw new Error('Введите целое число от 0 до 100')
      return parsed
    }
    case 'decimal': {
      if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error('Введите десятичную строку, например "0.013"')
      return trimmed
    }
    case 'url': {
      try {
        new URL(trimmed)
      } catch {
        throw new Error('Введите полную ссылку, например https://t.me/tgshop_support')
      }
      return trimmed
    }
    case 'boolean':
      return trimmed === 'true'
    case 'json':
      return JSON.parse(trimmed) as unknown
    default: {
      if (!trimmed) throw new Error('Заполните значение')
      return trimmed
    }
  }
}

export function SettingsClient({
  rows,
  canEdit
}: {
  rows: SettingRow[]
  canEdit: boolean
}) {
  const router = useRouter()
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((row) => [row.key, row.editable]))
  )
  const [status, setStatus] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('""')
  const [newError, setNewError] = useState<string | null>(null)

  function setDraft(key: string, value: string) {
    setDrafts((prev) => ({ ...prev, [key]: value }))
  }

  async function onSave(row: SettingRow) {
    setPendingKey(row.key)
    setStatus((prev) => ({ ...prev, [row.key]: '' }))
    setErrors((prev) => ({ ...prev, [row.key]: '' }))
    try {
      const value = toValue(row.kind, drafts[row.key] ?? '')
      const saved = await upsertSettingAction({ key: row.key, value })
      setStatus((prev) => ({ ...prev, [row.key]: `Сохранено: ${formatDateTime(saved.updatedAt)}` }))
      router.refresh()
    } catch (err) {
      setErrors((prev) => ({ ...prev, [row.key]: err instanceof Error ? err.message : 'Не удалось выполнить действие. Повторите попытку.' }))
    } finally {
      setPendingKey(null)
    }
  }

  async function onDelete(row: SettingRow) {
    if (!window.confirm(`Удалить настройку «${row.key}»?`)) return
    setPendingKey(row.key)
    setErrors((prev) => ({ ...prev, [row.key]: '' }))
    try {
      await deleteSettingAction(row.key)
      router.refresh()
    } catch (err) {
      setErrors((prev) => ({ ...prev, [row.key]: err instanceof Error ? err.message : 'Не удалось выполнить действие. Повторите попытку.' }))
    } finally {
      setPendingKey(null)
    }
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault()
    setNewError(null)
    if (!newKey.trim()) {
      setNewError('Укажите ключ настройки')
      return
    }
    setPendingKey(newKey)
    try {
      const value = JSON.parse(newValue) as unknown
      await upsertSettingAction({ key: newKey.trim(), value })
      setNewKey('')
      setNewValue('""')
      router.refresh()
    } catch (err) {
      setNewError(err instanceof Error ? err.message : 'Не удалось выполнить действие. Повторите попытку.')
    } finally {
      setPendingKey(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {!canEdit && (
        <p className="text-sm text-muted-foreground">
          Просмотр настроек. Изменять их может только владелец магазина.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {rows.map((row) => {
          const draft = drafts[row.key] ?? ''
          const busy = pendingKey === row.key
          return (
            <Card key={row.key}>
              <CardHeader className="flex flex-row items-start justify-between gap-3">
                <div>
                  <CardTitle>{row.label}</CardTitle>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">{row.key}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge variant={row.known ? 'secondary' : 'warning'}>{row.kind}</Badge>
                  {!row.exists && <Badge variant="destructive">Не задано</Badge>}
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <Label htmlFor={`setting-${row.key}`}>Значение</Label>
                {row.kind === 'boolean' ? (
                  <Select
                    id={`setting-${row.key}`}
                    value={draft || 'false'}
                    disabled={!canEdit || busy}
                    onChange={(e) => setDraft(row.key, e.target.value)}
                  >
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </Select>
                ) : row.kind === 'json' ? (
                  <Textarea
                    id={`setting-${row.key}`}
                    value={draft}
                    disabled={!canEdit || busy}
                    onChange={(e) => setDraft(row.key, e.target.value)}
                    className="font-mono text-xs"
                  />
                ) : (
                  <Input
                    id={`setting-${row.key}`}
                    type={row.kind === 'int' || row.kind === 'percent' ? 'number' : 'text'}
                    inputMode={row.kind === 'decimal' ? 'decimal' : undefined}
                    min={row.kind === 'int' || row.kind === 'percent' ? 0 : undefined}
                    max={row.kind === 'percent' ? 100 : undefined}
                    value={draft}
                    disabled={!canEdit || busy}
                    onChange={(e) => setDraft(row.key, e.target.value)}
                  />
                )}
                <p className="text-xs text-muted-foreground">{row.hint}</p>
                <div className="flex flex-wrap items-center gap-3">
                  {canEdit && (
                    <Button size="sm" onClick={() => void onSave(row)} disabled={busy}>
                      {t('common.save')}
                    </Button>
                  )}
                  {canEdit && !row.known && row.exists && (
                    <Button size="sm" variant="destructive" onClick={() => void onDelete(row)} disabled={busy}>
                      {t('common.delete')}
                    </Button>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {row.updatedAt ? `Обновлено: ${formatDateTime(row.updatedAt)}` : 'Ещё не сохранено'}
                  </span>
                </div>
                {status[row.key] && <p className="text-sm text-success">{status[row.key]}</p>}
                {errors[row.key] && <p className="text-sm text-destructive">{errors[row.key]}</p>}
              </CardContent>
            </Card>
          )
        })}
      </div>

      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle>Добавить настройку</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={onCreate} className="flex flex-col gap-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="newKey">Ключ</Label>
                  <Input
                    id="newKey"
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                    placeholder="payment_provider:cryptobot"
                    maxLength={200}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="newValue">Значение (JSON)</Label>
                  <Textarea
                    id="newValue"
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                    className="font-mono text-xs"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" disabled={pendingKey !== null}>
                  {t('common.create')}
                </Button>
                <span className="text-xs text-muted-foreground">
                  Укажите ключ и значение в JSON. Для стандартных настроек проверяется допустимый формат.
                </span>
              </div>
              {newError && <p className="text-sm text-destructive">{newError}</p>}
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
