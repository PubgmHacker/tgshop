import { Suspense } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { getEnv } from '../../../lib/env'
import { t } from '../../../lib/i18n'
import { LoginForm } from './login-form'
import { TelegramLoginButton } from './telegram-login-button'

/**
 * Rendered per request, not prerendered: `getEnv()` below reads the bot
 * identity, and the Docker build runs `next build` with no environment at all
 * (see apps/admin/Dockerfile), so prerendering this page would either fail the
 * image build or bake in an empty username. A login page has nothing worth
 * caching anyway.
 */
export const dynamic = 'force-dynamic'

export default function LoginPage() {
  // Optional on purpose: a shop that never provisions `tg:<id>` admins just
  // gets the password form. Rendering the widget without a username would
  // produce a Telegram iframe that errors instead of a button.
  const botUsername = getEnv().BOT_USERNAME

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl text-foreground">{t('auth.login.title')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Suspense is required here: LoginForm calls useSearchParams(), which
            bails out of static prerendering. The boundary keeps the shell
            renderable and shows a skeleton while it hydrates. */}
        <Suspense fallback={<div className="h-52 animate-pulse rounded-card bg-muted" />}>
          <LoginForm />
        </Suspense>
        {botUsername && (
          <>
            <div className="flex items-center gap-2">
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">{t('auth.login.or')}</span>
              <span className="h-px flex-1 bg-border" />
            </div>
            <TelegramLoginButton botUsername={botUsername} />
          </>
        )}
      </CardContent>
    </Card>
  )
}
