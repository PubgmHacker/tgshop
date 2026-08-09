'use client'

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export interface StockLevelDatum {
  planId: string
  planTitle: string
  productTitle: string
  available: number
  threshold: number
}

export function StockLevelsChart({ data }: { data: StockLevelDatum[] }) {
  const chartData = data.slice(0, 15).map((d) => ({ ...d, label: `${d.productTitle} / ${d.planTitle}` }))

  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 16, bottom: 0, left: 16 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} className="fill-muted-foreground" />
        <YAxis
          type="category"
          dataKey="label"
          width={180}
          tick={{ fontSize: 11 }}
          className="fill-muted-foreground"
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'hsl(var(--popover))',
            border: '1px solid hsl(var(--border))',
            borderRadius: 8,
            color: 'hsl(var(--popover-foreground))'
          }}
        />
        <Bar dataKey="available" radius={[0, 4, 4, 0]}>
          {chartData.map((entry) => (
            <Cell
              key={entry.planId}
              fill={entry.available <= entry.threshold ? 'hsl(var(--destructive))' : 'hsl(var(--success))'}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
