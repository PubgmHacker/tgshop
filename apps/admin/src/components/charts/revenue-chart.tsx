'use client'

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts'
import type { RevenuePoint } from '../../lib/actions/dashboard'
import { centsToDisplay } from '@tgshop/core/money'

export function RevenueChart({ data }: { data: RevenuePoint[] }) {
  const chartData = data.map((point) => ({ ...point, revenue: point.revenueCents / 100 }))

  if (!data.length) return <p className="py-12 text-center text-sm text-muted-foreground">Выручка появится после первых оплаченных заказов.</p>
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart accessibilityLayer data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="bucket" tick={{ fontSize: 12 }} className="fill-muted-foreground" />
        <YAxis tick={{ fontSize: 12 }} className="fill-muted-foreground" />
        <Tooltip
          formatter={(value: number) => [`$${centsToDisplay(Math.round(value * 100))}`, 'Выручка']}
          contentStyle={{
            backgroundColor: 'hsl(var(--popover))',
            border: '1px solid hsl(var(--border))',
            borderRadius: 8,
            color: 'hsl(var(--popover-foreground))'
          }}
        />
        <Line isAnimationActive={false} type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}
