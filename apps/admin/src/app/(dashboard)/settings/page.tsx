import { AdminRole } from '@tgshop/db'
import { listSettingsAction } from '../../../lib/actions/settings'
import { SETTING_DEFINITIONS, findSettingDefinition, type SettingKind } from '../../../lib/schemas'
import { hasRole, requireSession } from '../../../lib/rbac'
import { SettingsClient, type SettingRow } from './settings-client'
import { t } from '../../../lib/i18n'

export const dynamic = 'force-dynamic'

/**
 * `Setting.value` is a Json column. Flatten it to the text shape the editor
 * works with here, on the server, so the client component never has to deal
 * with an untyped JSON value in its props.
 */
function toEditable(kind: SettingKind, value: unknown): string {
  if (value === null || value === undefined) return kind === 'boolean' ? 'false' : ''
  if (kind === 'boolean') return value === true ? 'true' : 'false'
  if (kind === 'json') return JSON.stringify(value, null, 2)
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

export default async function SettingsPage() {
  const session = await requireSession()

  const settings = await listSettingsAction()
  const stored = new Map(settings.map((setting) => [setting.key, setting]))

  // Known keys first, in definition order, so the shop's real knobs are on top
  // even when they have never been written. Free-form keys follow, sorted.
  const knownRows: SettingRow[] = SETTING_DEFINITIONS.map((definition) => {
    const setting = stored.get(definition.key)
    return {
      key: definition.key,
      label: definition.label,
      kind: definition.kind,
      hint: definition.hint,
      editable: toEditable(definition.kind, setting?.value ?? null),
      updatedAt: setting ? setting.updatedAt.toISOString() : null,
      known: true,
      exists: Boolean(setting)
    }
  })

  const extraRows: SettingRow[] = settings
    .filter((setting) => !findSettingDefinition(setting.key))
    .map((setting) => ({
      key: setting.key,
      label: setting.key,
      kind: 'json' as SettingKind,
      hint: 'Дополнительный параметр. Значение хранится в формате JSON.',
      editable: toEditable('json', setting.value),
      updatedAt: setting.updatedAt.toISOString(),
      known: false,
      exists: true
    }))

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('settings.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Настройки оплаты, выдачи и уведомлений. Изменения сохраняются в журнале действий.
        </p>
      </div>
      <SettingsClient rows={[...knownRows, ...extraRows]} canEdit={hasRole(session.role, AdminRole.OWNER)} />
    </div>
  )
}
