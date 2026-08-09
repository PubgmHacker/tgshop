import Link from 'next/link'
import { searchUsersAction } from '../../../lib/actions/users'
import { requireSession } from '../../../lib/rbac'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { UsersSearch } from './users-search'
import { formatDateTime } from '../../../lib/format'
import { t } from '../../../lib/i18n'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 20

export default async function UsersPage({
  searchParams
}: {
  searchParams: { q?: string | string[]; page?: string | string[] }
}) {
  requireSession()

  const rawQuery = searchParams.q
  const query = (Array.isArray(rawQuery) ? rawQuery[0] : rawQuery) ?? ''
  const rawPage = searchParams.page
  const pageValue = Array.isArray(rawPage) ? rawPage[0] : rawPage
  const parsedPage = Number.parseInt(pageValue || '1', 10)
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1

  const result = await searchUsersAction({ query, page, pageSize: PAGE_SIZE })
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize))

  function pageHref(target: number): string {
    const params = new URLSearchParams()
    if (query) params.set('q', query)
    params.set('page', String(target))
    return `/users?${params.toString()}`
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('users.title')}</h1>

      <UsersSearch initialQuery={query} />

      <div className="text-sm text-muted-foreground">
        {result.total} user{result.total === 1 ? '' : 's'} · page {result.page} / {totalPages}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Telegram ID</TableHead>
            <TableHead>Username</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Lang</TableHead>
            <TableHead>Joined</TableHead>
            <TableHead>{t('common.status')}</TableHead>
            <TableHead>{t('common.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.users.map((user) => (
            <TableRow key={user.id}>
              {/* tgId is a BigInt — stringify before it reaches the DOM/props. */}
              <TableCell className="tabular-nums">{String(user.tgId)}</TableCell>
              <TableCell>{user.username ? `@${user.username}` : '—'}</TableCell>
              <TableCell>{user.firstName ?? '—'}</TableCell>
              <TableCell>{user.languageCode ?? '—'}</TableCell>
              <TableCell className="whitespace-nowrap">{formatDateTime(user.createdAt)}</TableCell>
              <TableCell>
                <Badge variant={user.isBlocked ? 'destructive' : 'success'}>
                  {user.isBlocked ? 'blocked' : 'active'}
                </Badge>
              </TableCell>
              <TableCell>
                <Link href={`/users/${user.id}`}>
                  <Button size="sm" variant="outline">
                    Details
                  </Button>
                </Link>
              </TableCell>
            </TableRow>
          ))}
          {result.users.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground">
                {t('common.noResults')}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <div className="flex items-center gap-2">
        {page > 1 && (
          <Link href={pageHref(page - 1)}>
            <Button variant="outline" size="sm">
              ← Prev
            </Button>
          </Link>
        )}
        {page < totalPages && (
          <Link href={pageHref(page + 1)}>
            <Button variant="outline" size="sm">
              Next →
            </Button>
          </Link>
        )}
      </div>
    </div>
  )
}
