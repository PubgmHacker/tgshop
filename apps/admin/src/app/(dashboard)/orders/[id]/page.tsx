import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AdminRole } from '@tgshop/db'
import { getOrderDetailAction } from '../../../../lib/actions/orders'
import { canManualDeliverOrder, canRedeliverOrder, canRefundOrder } from '../../../../lib/orders-policy'
import { hasRole, requireSession } from '../../../../lib/rbac'
import { Card, CardContent, CardHeader, CardTitle } from '../../../../components/ui/card'
import { Badge } from '../../../../components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../../components/ui/table'
import { orderStatusVariant, paymentStatusVariant } from '../status-variant'
import { OrderActions } from './order-actions'
import { formatEnum, formatCents, formatDateTime, formatJson } from '../../../../lib/format'

export const dynamic = 'force-dynamic'

export default async function OrderDetailPage({ params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const session = await requireSession()
  const params = await paramsPromise

  const order = await getOrderDetailAction(params.id).catch(() => null)
  if (!order) notFound()

  const canAct = hasRole(session.role, AdminRole.ADMIN)
  // Both predicates are the ones the server actions enforce, so a button is
  // enabled exactly when the action behind it would succeed.
  const canRedeliver = canRedeliverOrder(order)
  const canRefund = canRefundOrder(order.status)
  const canManualDeliver = canManualDeliverOrder(order)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Заказ</h1>
          <p className="font-mono text-xs text-muted-foreground">{order.id}</p>
        </div>
        <Badge variant={orderStatusVariant(order.status)}>{formatEnum(order.status)}</Badge>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Детали заказа</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Создано (UTC)</dt>
              <dd>{formatDateTime(order.createdAt)}</dd>
              <dt className="text-muted-foreground">Выдано</dt>
              <dd>{formatDateTime(order.deliveredAt)}</dd>
              <dt className="text-muted-foreground">Сумма</dt>
              <dd className="tabular-nums">{formatCents(order.amountCents)}</dd>
              <dt className="text-muted-foreground">Способ оплаты</dt>
              <dd>{formatEnum(order.provider)}</dd>
              <dt className="text-muted-foreground">ID платежа</dt>
              <dd className="font-mono text-xs">{order.externalId ?? '—'}</dd>
              <dt className="text-muted-foreground">Товар</dt>
              <dd>{order.plan.product.title}</dd>
              <dt className="text-muted-foreground">Тариф</dt>
              <dd>{order.plan.title}</dd>
              <dt className="text-muted-foreground">Промокод</dt>
              <dd>{order.promo ? order.promo.code : '—'}</dd>
              <dt className="text-muted-foreground">Позиция склада</dt>
              <dd className="font-mono text-xs">{order.stockItem ? order.stockItem.id : '—'}</dd>
              <dt className="text-muted-foreground">Почта покупателя</dt>
              <dd className="font-mono text-xs">{order.customerEmail ?? '—'}</dd>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Покупатель</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Telegram ID</dt>
              <dd className="tabular-nums">{String(order.user.tgId)}</dd>
              <dt className="text-muted-foreground">Имя в Telegram</dt>
              <dd>{order.user.username ? `@${order.user.username}` : '—'}</dd>
              <dt className="text-muted-foreground">Имя</dt>
              <dd>{order.user.firstName ?? '—'}</dd>
              <dt className="text-muted-foreground">Профиль</dt>
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
          <CardTitle>Действия</CardTitle>
        </CardHeader>
        <CardContent>
          <OrderActions
            orderId={order.id}
            canAct={canAct}
            canRedeliver={canRedeliver}
            canRefund={canRefund}
            canManualDeliver={canManualDeliver}
            customerEmail={order.customerEmail}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Платежи</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Создано (UTC)</TableHead>
                <TableHead>Способ оплаты</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Сумма</TableHead>
                <TableHead>Сеть / транзакция</TableHead>
                <TableHead>ID счёта</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.payments.map((payment) => (
                <TableRow key={payment.id}>
                  <TableCell className="whitespace-nowrap">{formatDateTime(payment.createdAt)}</TableCell>
                  <TableCell>{formatEnum(payment.provider)}</TableCell>
                  <TableCell>
                    <Badge variant={paymentStatusVariant(payment.status)}>{formatEnum(payment.status)}</Badge>
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
          <CardTitle>Операции по балансу</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Создано (UTC)</TableHead>
                <TableHead>Тип</TableHead>
                <TableHead>Сумма</TableHead>
                <TableHead>Комментарий</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.ledgerEntries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="whitespace-nowrap">{formatDateTime(entry.createdAt)}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{formatEnum(entry.type)}</Badge>
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
