import { getDashboardDataAction } from '../../lib/actions/dashboard'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { StatTile } from '../../components/stat-tile'
import { RevenueChart } from '../../components/charts/revenue-chart'
import { OrdersByStatusChart } from '../../components/charts/orders-status-chart'
import { PaymentSplitChart } from '../../components/charts/payment-split-chart'
import { StockLevelsChart } from '../../components/charts/stock-levels-chart'
import { centsToDisplay } from '@tgshop/core'
import { t } from '../../lib/i18n'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const data = await getDashboardDataAction(30)

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('dashboard.title')}</h1>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile label={t('dashboard.revenue')} value={`$${centsToDisplay(data.totals.revenueCents)}`} sub="30d" />
        <StatTile label={t('dashboard.orders')} value={String(data.totals.orders)} sub="30d" />
        <StatTile label={t('dashboard.conversion')} value={`${data.totals.conversionPercent}%`} sub="30d" />
        <StatTile label={t('dashboard.arpu')} value={`$${centsToDisplay(data.totals.arpuCents)}`} sub="30d" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.revenue')}</CardTitle>
          </CardHeader>
          <CardContent>
            <RevenueChart data={data.revenueByDay} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.ordersByStatus')}</CardTitle>
          </CardHeader>
          <CardContent>
            <OrdersByStatusChart data={data.ordersByStatus} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.paymentSplit')}</CardTitle>
          </CardHeader>
          <CardContent>
            <PaymentSplitChart data={data.paymentSplit} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.stockLevels')}</CardTitle>
          </CardHeader>
          <CardContent>
            <StockLevelsChart data={data.stockLevels} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('dashboard.topProducts')}</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1">Product</th>
                <th className="py-1">Orders</th>
                <th className="py-1">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {data.topProducts.map((p) => (
                <tr key={p.productId} className="border-t border-border">
                  <td className="py-2">{p.title}</td>
                  <td className="py-2 tabular-nums">{p.orders}</td>
                  <td className="py-2 tabular-nums">${centsToDisplay(p.revenueCents)}</td>
                </tr>
              ))}
              {data.topProducts.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-4 text-center text-muted-foreground">
                    {t('common.noResults')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
