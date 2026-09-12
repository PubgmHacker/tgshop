import { Sidebar } from '../../components/sidebar'
import { ThemeToggle } from '../../components/theme-toggle'
import { Button } from '../../components/ui/button'
import { logoutAction } from '../../lib/actions/auth'
import { getSession } from '../../lib/session'
import { t } from '../../lib/i18n'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:p-3 focus:text-primary-foreground">Перейти к содержимому</a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
          <div className="min-w-0 break-all text-sm text-muted-foreground">
            <span>{session?.email}</span>
            <span className="ml-2 whitespace-nowrap">{session?.role === 'OWNER' ? 'Владелец' : session?.role === 'ADMIN' ? 'Администратор' : 'Поддержка'}</span>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <form action={logoutAction}>
              <Button type="submit" variant="outline" size="sm">
                {t('auth.logout')}
              </Button>
            </form>
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  )
}
