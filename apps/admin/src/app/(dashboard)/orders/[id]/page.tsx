import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AdminRole } from '@tgshop/db'
import { getOrderDetailAction } from '../../../../lib/actions/orders'
import { canRedeliverOrder, canRefundOrder } from '../../../../lib/orders-policy'
import { hasRole, requireSession } from '../../../../lib/rbac'
import { Card, CardContent, CardHeader, CardTitle } from '../../../../components/ui/card'
import { Badge } from '../../../../components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../../components/ui/table'
import { orderStatusVariant, paymentStatusVariant } from '../status-variant'
import { OrderActions } from './order-actions'
import { formatCents, formatDateTime, formatJson } from '../../../../lib/format'

export const dynamic = 'force-dynamic'

export default async function OrderDetailPage({ params }: { params: { id: string } }) {
  const session = requireSession()

  const order = await getOrderDetailAction(params.id).catch(() => null)
  if (!order) notFound()

  const canAct = hasRole(session.role, AdminRole.ADMIN)
  // Both predicates are the ones the server actions enforce, so a button is
  // enabled exactly when the action behind it would succeed.
  const canRedeliver = canRedeliverOrder(order)
  const canRefund = canRefundOrder(order.status)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Order</h1>
          <p className="font-mono text-xs text-muted-foreground">{order.id}</p>
        </div>
        <Badge variant={orderStatusVariant(order.status)}>{order.status}</Badge>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Created</dt>
              <dd>{formatDateTime(order.createdAt)}</dd>
              <dt className="text-muted-foreground">Delivered</dt>
              <dd>{formatDateTime(order.deliveredAt)}</dd>
              <dt className="text-muted-foreground">Amount</dt>
              <dd className="tabular-nums">{formatCents(order.amountCents)}</dd>
              <dt className="text-muted-foreground">Provider</dt>
              <dd>{order.provider}</dd>
              <dt className="text-muted-foreground">External ID</dt>
              <dd className="font-mono text-xs">{order.externalId ?? '—'}</dd>
              <dt className="text-muted-foreground">Product</dt>
              <dd>{order.plan.product.title}</dd>
              <dt className="text-muted-foreground">Plan</dt>
              <dd>{order.plan.title}</dd>
              <dt className="text-muted-foreground">Promo</dt>
              <dd>{order.promo ? order.promo.code : '—'}</dd>
              <dt className="text-muted-foreground">Stock item</dt>
              <dd className="font-mono text-xs">{order.stockItem ? order.stockItem.id : '—'}</dd>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>User</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Telegram ID</dt>
              <dd className="tabular-nums">{String(order.user.tgId)}</dd>
              <dt className="text-muted-foreground">Username</dt>
              <dd>{order.user.username ? `@${order.user.username}` : '—'}</dd>
              <dt className="text-muted-foreground">Name</dt>
              <dd>{order.user.firstName ?? '—'}</dd>
              <dt className="text-muted-foreground">Profile</dt>
              <dd>
                <Link className="underline underline-offset-4" href={`/users/${order.userId}`}>
                  Open user
                </Link>
              </dd>
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <OrderActions
            orderId={order.id}
            canAct={canAct}
            canRedeliver={canRedeliver}
            canRefund={canRefund}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payments</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Created</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Network / tx</TableHead>
                <TableHead>Invoice ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.payments.map((payment) => (
                <TableRow key={payment.id}>
                  <TableCell className="whitespace-nowrap">{formatDateTime(payment.createdAt)}</TableCell>
                  <TableCell>{payment.provider}</TableCell>
                  <TableCell>
                    <Badge variant={paymentStatusVariant(payment.status)}>{payment.status}</Badge>
                  </TableCell>
                  {/* Payment.amount is a BigInt in the asset's smallest unit — shown raw, not as cents. */}
                  <TableCell className="tabular-nums">
                    {String(payment.amount)} {payment.asset}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {payment.network ?? '—'}
                    {payment.txHash ? ` · ${payment.txHash}` : ''}
                    {payment.confirmations > 0 ? ` (${payment.confirmations} conf)` : ''}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{payment.providerInvoiceId ?? '—'}</TableCell>
                </TableRow>
              ))}
              {order.payments.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No payments recorded
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          {order.payments.map((payment) => (
            <div key={`${payment.id}-raw`} className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">
                Raw payload · <span className="font-mono text-xs">{payment.id}</span>
              </h3>
              <pre className="max-h-96 overflow-auto rounded-md border border-border bg-muted p-3 font-mono text-xs">
                {formatJson(payment.rawPayload)}
              </pre>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ledger entries</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Created</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Comment</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.ledgerEntries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="whitespace-nowrap">{formatDateTime(entry.createdAt)}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{entry.type}</Badge>
                  </TableCell>
                  <TableCell
                    className={
                      entry.amountCents < 0 ? 'tabular-nums text-destructive' : 'tabular-nums text-success'
                    }
                  >
                    {formatCents(entry.amountCents)}
                  </TableCell>
                  <TableCell>{entry.comment ?? '—'}</TableCell>
                </TableRow>
              ))}
              {order.ledgerEntries.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No ledger entries
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
