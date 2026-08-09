import { Sidebar } from '../../components/sidebar'
import { ThemeToggle } from '../../components/theme-toggle'
import { Button } from '../../components/ui/button'
import { logoutAction } from '../../lib/actions/auth'
import { getSession } from '../../lib/session'
import { t } from '../../lib/i18n'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = getSession()

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border px-6 py-3">
          <div className="text-sm text-muted-foreground">
            {session?.email} · {session?.role}
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
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  )
}
