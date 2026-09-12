'use client'

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { OrderStatus } from '@tgshop/db'
import { formatEnum } from '../../lib/format'

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'hsl(38 92% 50%)',
  PAID: 'hsl(217 91% 60%)',
  DELIVERING: 'hsl(199 89% 48%)',
  DELIVERED: 'hsl(142 71% 45%)',
  FAILED: 'hsl(0 72% 51%)',
  REFUNDED: 'hsl(280 65% 60%)',
  EXPIRED: 'hsl(220 9% 46%)'
}

export function OrdersByStatusChart({ data }: { data: { status: OrderStatus; count: number }[] }) {
  if (!data.length) return <p className="py-12 text-center text-sm text-muted-foreground">За выбранный период заказов нет.</p>
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart accessibilityLayer data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis tickFormatter={formatEnum} dataKey="status" tick={{ fontSize: 12 }} className="fill-muted-foreground" />
        <YAxis tick={{ fontSize: 12 }} allowDecimals={false} className="fill-muted-foreground" />
        <Tooltip
          labelFormatter={(value) => formatEnum(String(value))}
          contentStyle={{
            backgroundColor: 'hsl(var(--popover))',
            border: '1px solid hsl(var(--border))',
            borderRadius: 8,
            color: 'hsl(var(--popover-foreground))'
          }}
        />
        <Bar name="Заказов" isAnimationActive={false} dataKey="count" radius={[4, 4, 0, 0]}>
          {data.map((entry) => (
            <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? 'hsl(var(--primary))'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
