import { Suspense } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { t } from '../../../lib/i18n'
import { LoginForm } from './login-form'

export default function LoginPage() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl text-foreground">{t('auth.login.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Suspense is required here: LoginForm calls useSearchParams(), which
            bails out of static prerendering. The boundary keeps the whole page
            prerenderable and shows a skeleton while it hydrates. */}
        <Suspense fallback={<div className="h-52 animate-pulse rounded-card bg-muted" />}>
          <LoginForm />
        </Suspense>
      </CardContent>
    </Card>
  )
}
