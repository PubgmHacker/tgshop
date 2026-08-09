import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AdminRole } from '@tgshop/db'
import { getUserDetailAction, listUserLedgerAction } from '../../../../lib/actions/users'
import { hasRole, requireSession } from '../../../../lib/rbac'
import { Card, CardContent, CardHeader, CardTitle } from '../../../../components/ui/card'
import { StatTile } from '../../../../components/stat-tile'
import { Badge } from '../../../../components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../../components/ui/table'
import { Button } from '../../../../components/ui/button'
import { orderStatusVariant } from '../../orders/status-variant'
import { UserActions } from './user-actions'
import { formatCents, formatDateTime } from '../../../../lib/format'
import { t } from '../../../../lib/i18n'

export const dynamic = 'force-dynamic'

export default async function UserDetailPage({ params }: { params: { id: string } }) {
  const session = requireSession()

  const [detail, ledger] = await Promise.all([
    getUserDetailAction(params.id).catch(() => null),
    listUserLedgerAction(params.id).catch(() => [])
  ])

  if (!detail?.user) notFound()
  const { user, orders, balanceCents } = detail

  const spentCents = orders.reduce((sum, order) => sum + order.amountCents, 0)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {user.username ? `@${user.username}` : (user.firstName ?? 'User')}
          </h1>
          <p className="font-mono text-xs text-muted-foreground">
            {user.id} · tg {String(user.tgId)}
          </p>
        </div>
        <Badge variant={user.isBlocked ? 'destructive' : 'success'}>{user.isBlocked ? 'blocked' : 'active'}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile
          label={t('users.balance')}
          value={formatCents(balanceCents)}
          tone={balanceCents < 0 ? 'destructive' : 'default'}
          sub="ledger sum"
        />
        <StatTile label="Orders" value={String(orders.length)} sub="latest 100" />
        <StatTile label="Ordered value" value={formatCents(spentCents)} sub="all statuses" />
        <StatTile label="Joined" value={formatDateTime(user.createdAt)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <UserActions
            userId={user.id}
            isBlocked={user.isBlocked}
            canAct={hasRole(session.role, AdminRole.ADMIN)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ledger history</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Created</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Comment</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ledger.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="whitespace-nowrap">{formatDateTime(entry.createdAt)}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{entry.type}</Badge>
                  </TableCell>
                  <TableCell
                    className={entry.amountCents < 0 ? 'tabular-nums text-destructive' : 'tabular-nums text-success'}
                  >
                    {formatCents(entry.amountCents)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {entry.orderId ? (
                      <Link className="underline underline-offset-4" href={`/orders/${entry.orderId}`}>
                        {entry.orderId}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell>{entry.comment ?? '—'}</TableCell>
                </TableRow>
              ))}
              {ledger.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    {t('common.noResults')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('users.orderHistory')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Created</TableHead>
                <TableHead>Product / plan</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>{t('common.status')}</TableHead>
                <TableHead>{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="whitespace-nowrap">{formatDateTime(order.createdAt)}</TableCell>
                  <TableCell>
                    {order.plan.product.title} / {order.plan.title}
                  </TableCell>
                  <TableCell className="tabular-nums">{formatCents(order.amountCents)}</TableCell>
                  <TableCell>{order.provider}</TableCell>
                  <TableCell>
                    <Badge variant={orderStatusVariant(order.status)}>{order.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <Link href={`/orders/${order.id}`}>
                      <Button size="sm" variant="outline">
                        Details
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
              {orders.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    {t('common.noResults')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
