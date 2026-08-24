'use client'

import { useI18n } from '@/i18n/I18nProvider'
import { useBackButton } from '@/hooks/useBackButton'
import { useConfigData } from '@/hooks/useApi'
import { Icon, type IconName } from '@/components/Icons'
import { useTheme } from '@/lib/ThemeProvider'
import { openPaymentUrl } from '@/lib/payments'
import { triggerHaptic } from '@/lib/TelegramProvider'

function SettingRow({
  icon,
  title,
  subtitle,
  trailing,
  onClick
}: {
  icon: IconName
  title: string
  subtitle: string
  trailing: React.ReactNode
  onClick?: () => void
}): JSX.Element {
  const Wrapper = onClick ? 'button' : 'div'
  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-card border border-line bg-card p-4 text-left ${
        onClick ? 'transition-colors active:bg-card-strong' : ''
      }`}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-card-strong text-muted">
        <Icon name={icon} size={18} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-semibold text-ink">{title}</span>
        <span className="text-xs text-faint">{subtitle}</span>
      </span>
      <span className="shrink-0">{trailing}</span>
    </Wrapper>
  )
}

function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}): JSX.Element {
  return (
    <div className="flex rounded-full border border-line bg-card-strong p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => {
            triggerHaptic('light')
            onChange(option.value)
          }}
          className={`rounded-full px-3 py-1.5 text-[11px] font-bold transition-colors ${
            value === option.value ? 'bg-cta text-cta-ink' : 'text-faint'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export default function SettingsPage(): JSX.Element {
  const { t, locale, setLocale } = useI18n()
  const { theme, setTheme } = useTheme()
  const config = useConfigData()

  useBackButton(true)

  return (
    <div className="page-enter flex flex-1 flex-col gap-4 px-4 pt-3">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">{t('settings.title')}</h1>
        <p className="max-w-[240px] text-xs leading-relaxed text-muted">{t('settings.subtitle')}</p>
      </header>

      <div className="flex flex-col gap-2.5">
        <SettingRow
          icon={theme === 'dark' ? 'moon' : 'sun'}
          title={t('settings.theme')}
          subtitle={t('settings.theme.desc')}
          trailing={
            <Segmented
              value={theme}
              options={[
                { value: 'dark', label: t('settings.theme.dark') },
                { value: 'light', label: t('settings.theme.light') }
              ]}
              onChange={setTheme}
            />
          }
        />

        <SettingRow
          icon="globe"
          title={t('settings.language')}
          subtitle={t('settings.language.desc')}
          trailing={
            <Segmented
              value={locale}
              options={[
                { value: 'ru' as const, label: 'RU' },
                { value: 'en' as const, label: 'EN' }
              ]}
              onChange={setLocale}
            />
          }
        />

        <SettingRow
          icon="support"
          title={t('settings.support')}
          subtitle={config.data ? `@${config.data.supportUrl.split('/').pop() ?? ''}` : t('settings.support.desc')}
          trailing={<Icon name="chevron-right" size={16} className="text-faint" />}
          onClick={() => {
            triggerHaptic('light')
            if (config.data?.supportUrl) openPaymentUrl(config.data.supportUrl)
          }}
        />
      </div>
    </div>
  )
}
