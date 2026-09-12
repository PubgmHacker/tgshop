'use client'

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, Legend } from 'recharts'
import type { PaymentProvider } from '@tgshop/db'
import { formatEnum } from '../../lib/format'
import { centsToDisplay } from '@tgshop/core/money'

const PROVIDER_COLORS: Record<string, string> = {
  BALANCE: 'hsl(217 91% 60%)',
  CRYPTOBOT: 'hsl(142 71% 45%)',
  STARS: 'hsl(38 92% 50%)',
  TRON_TRC20: 'hsl(280 65% 60%)'
}

export function PaymentSplitChart({
  data
}: {
  data: { provider: PaymentProvider; count: number; revenueCents: number }[]
}) {
  const chartData = data.map((d) => ({ name: d.provider, value: d.revenueCents, count: d.count }))

  if (!data.length) return <p className="py-12 text-center text-sm text-muted-foreground">Оплаченных заказов пока нет.</p>
  return (
    <ResponsiveContainer width="100%" height={280}>
      <PieChart>
        <Pie isAnimationActive={false} data={chartData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={100} paddingAngle={2}>
          {chartData.map((entry) => (
            <Cell key={entry.name} fill={PROVIDER_COLORS[entry.name] ?? 'hsl(var(--primary))'} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value: number, _name, item) => [
            `$${centsToDisplay(value)} (заказов: ${(item.payload as { count: number }).count})`,
            item.payload && 'name' in (item.payload as object) ? formatEnum((item.payload as { name: string }).name) : ''
          ]}
          contentStyle={{
            backgroundColor: 'hsl(var(--popover))',
            border: '1px solid hsl(var(--border))',
            borderRadius: 8,
            color: 'hsl(var(--popover-foreground))'
          }}
        />
        <Legend formatter={formatEnum} />
      </PieChart>
    </ResponsiveContainer>
  )
}
