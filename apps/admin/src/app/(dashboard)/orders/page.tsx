import Link from 'next/link'
import { OrderStatus, PaymentProvider } from '@tgshop/db'
import { listOrdersAction } from '../../../lib/actions/orders'
import { requireSession } from '../../../lib/rbac'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table'
import { Badge } from '../../../components/ui/badge'
import { OrdersFilters } from './orders-filters'
import { orderStatusVariant } from './status-variant'
import { formatEnum, formatCents, formatDateTime } from '../../../lib/format'
import { t } from '../../../lib/i18n'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 20

type SearchParams = Record<string, string | string[] | undefined>

function first(params: SearchParams, key: string): string {
  const value = params[key]
  if (Array.isArray(value)) return value[0] ?? ''
  return value ?? ''
}

export default async function OrdersPage({ searchParams: searchParamsPromise }: { searchParams: Promise<SearchParams> }) {
  await requireSession()
  const searchParams = await searchParamsPromise

  const statusParam = first(searchParams, 'status')
  const providerParam = first(searchParams, 'provider')
  const userId = first(searchParams, 'userId')
  const query = first(searchParams, 'query')
  const dateFrom = first(searchParams, 'dateFrom')
  const dateTo = first(searchParams, 'dateTo')
  const pageParam = Number.parseInt(first(searchParams, 'page') || '1', 10)
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1

  // Only pass values the schema/Prisma will accept — a bogus enum from the URL
  // must not reach the query.
  const statuses = Object.values(OrderStatus)
  const providers = Object.values(PaymentProvider)
  const status = statuses.includes(statusParam as OrderStatus) ? statusParam : undefined
  const provider = providers.includes(providerParam as PaymentProvider)
    ? (providerParam as PaymentProvider)
    : undefined

  const from = dateFrom ? new Date(`${dateFrom}T00:00:00.000Z`) : null
  // `to` is inclusive of the whole selected day.
  const to = dateTo ? new Date(`${dateTo}T23:59:59.999Z`) : null

  const result = await listOrdersAction({
    status,
    provider,
    userId: userId || undefined,
    query: query || undefined,
    dateFrom: from && !Number.isNaN(from.getTime()) ? from : null,
    dateTo: to && !Number.isNaN(to.getTime()) ? to : null,
    page,
    pageSize: PAGE_SIZE
  })

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize))

  function pageHref(target: number): string {
    const params = new URLSearchParams()
    if (statusParam) params.set('status', statusParam)
    if (providerParam) params.set('provider', providerParam)
    if (userId) params.set('userId', userId)
    if (query) params.set('query', query)
    if (dateFrom) params.set('dateFrom', dateFrom)
    if (dateTo) params.set('dateTo', dateTo)
    params.set('page', String(target))
    return `/orders?${params.toString()}`
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('orders.title')}</h1>

      <OrdersFilters
        initial={{ status: statusParam, provider: providerParam, userId, query, dateFrom, dateTo }}
        statuses={statuses}
        providers={providers}
      />

      <div className="text-sm text-muted-foreground">
        Заказов: {result.total} · Страница {result.page} из {totalPages}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Создано (UTC)</TableHead>
            <TableHead>Заказ</TableHead>
            <TableHead>Покупатель</TableHead>
            <TableHead>Товар / тариф</TableHead>
            <TableHead>Сумма</TableHead>
            <TableHead>Способ оплаты</TableHead>
            <TableHead>{t('common.status')}</TableHead>
            <TableHead>{t('common.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.orders.map((order) => (
            <TableRow key={order.id}>
              <TableCell className="whitespace-nowrap">{formatDateTime(order.createdAt)}</TableCell>
              <TableCell className="font-mono text-xs">{order.id}</TableCell>
              <TableCell>
                <Link className="underline underline-offset-4" href={`/users/${order.userId}`}>
                  {order.user.username ? `@${order.user.username}` : String(order.user.tgId)}
                </Link>
              </TableCell>
              <TableCell>
                {order.plan.product.title} / {order.plan.title}
              </TableCell>
              <TableCell className="tabular-nums">{formatCents(order.amountCents)}</TableCell>
              <TableCell>
                <Badge variant="secondary">{formatEnum(order.provider)}</Badge>
              </TableCell>
              <TableCell>
                <Badge variant={orderStatusVariant(order.status)}>{formatEnum(order.status)}</Badge>
              </TableCell>
              <TableCell>
                <Link href={`/orders/${order.id}`} className="inline-flex min-h-11 items-center rounded-md border border-input px-3 py-2 text-sm hover:bg-accent">
                    Подробнее
                  </Link>
              </TableCell>
            </TableRow>
          ))}
          {result.orders.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-muted-foreground">
                {t('common.noResults')}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <div className="flex items-center gap-2">
        {page > 1 && (
          <Link href={pageHref(page - 1)} className="inline-flex min-h-11 items-center rounded-md border border-input px-3 py-2 text-sm hover:bg-accent">
              ← Назад
            </Link>
        )}
        {page < totalPages && (
          <Link href={pageHref(page + 1)} className="inline-flex min-h-11 items-center rounded-md border border-input px-3 py-2 text-sm hover:bg-accent">
              Далее →
            </Link>
        )}
      </div>
    </div>
  )
}
