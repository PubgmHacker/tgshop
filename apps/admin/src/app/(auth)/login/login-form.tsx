'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { loginAction } from '../../../lib/actions/auth'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { t } from '../../../lib/i18n'

/**
 * The form is split out of page.tsx because useSearchParams() opts a component
 * into client-side rendering: without a Suspense boundary above it, Next fails
 * the production build on prerender of /login.
 */
export function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [totp, setTotp] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      const result = await loginAction({ email, password, totp: totp || undefined })
      if (!result.ok) {
        setError(result.error ?? 'auth.login.error')
        return
      }
      // Only allow same-origin relative paths: a `next` of "https://evil.tld"
      // would otherwise turn the login page into an open redirect.
      const requested = searchParams.get('next')
      const next = requested && requested.startsWith('/') && !requested.startsWith('//') ? requested : '/'
      router.push(next)
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="email">{t('auth.login.email')}</Label>
        <Input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="password">{t('auth.login.password')}</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="totp">{t('auth.login.totp')}</Label>
        <Input
          id="totp"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={totp}
          onChange={(e) => setTotp(e.target.value)}
        />
      </div>
      {error && <p className="text-sm text-destructive">{t('auth.login.error')}</p>}
      <Button type="submit" disabled={pending}>
        {t('auth.login.submit')}
      </Button>
    </form>
  )
}
