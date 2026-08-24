'use client'

import { triggerHaptic } from '@/lib/TelegramProvider'

interface TextFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  maxLength?: number
  inputMode?: 'text' | 'numeric' | 'decimal' | 'url'
}

export function TextField({ label, value, onChange, placeholder, maxLength, inputMode = 'text' }: TextFieldProps): JSX.Element {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-muted">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        inputMode={inputMode}
        className="tile w-full rounded-tile px-3.5 py-3 text-sm text-ink outline-none placeholder:text-faint"
      />
    </label>
  )
}

interface TextAreaFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
  maxLength?: number
  hint?: string
}

export function TextAreaField({ label, value, onChange, placeholder, rows = 3, maxLength, hint }: TextAreaFieldProps): JSX.Element {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-muted">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={rows}
        maxLength={maxLength}
        className="tile w-full resize-none rounded-tile px-3.5 py-3 text-sm text-ink outline-none placeholder:text-faint"
      />
      {hint ? <span className="text-xs text-faint">{hint}</span> : null}
    </label>
  )
}

interface SelectFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
}

export function SelectField({ label, value, onChange, options }: SelectFieldProps): JSX.Element {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-muted">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="tile w-full appearance-none rounded-tile px-3.5 py-3 text-sm text-ink outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

interface ToggleFieldProps {
  label: string
  value: boolean
  onChange: (value: boolean) => void
}

export function ToggleField({ label, value, onChange }: ToggleFieldProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => {
        triggerHaptic('light')
        onChange(!value)
      }}
      className="tile flex w-full items-center justify-between rounded-tile px-3.5 py-3"
    >
      <span className="text-sm font-medium text-ink">{label}</span>
      <span
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${value ? 'bg-cta' : 'bg-line-strong'}`}
        aria-hidden
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${value ? 'left-[22px]' : 'left-0.5'}`}
        />
      </span>
    </button>
  )
}

/** Error line under a form; renders nothing when there is no error. */
export function FormError({ message }: { message: string | null }): JSX.Element | null {
  if (!message) return null
  return <p className="text-sm text-danger">{message}</p>
}
