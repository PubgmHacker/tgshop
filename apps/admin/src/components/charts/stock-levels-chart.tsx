import Link from 'next/link'

export interface StockLevelDatum {
  planId: string
  planTitle: string
  productTitle: string
  available: number
  threshold: number
}

/** Exact counts remain legible even when every plan has zero stock. */
export function StockLevelsChart({ data }: { data: StockLevelDatum[] }) {
  if (!data.length) return <p className="py-12 text-center text-sm text-muted-foreground">Нет тарифов с выдачей со склада.</p>
  return (
    <div className="max-h-80 overflow-auto" tabIndex={0} role="region" aria-label="Остатки по тарифам">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
          <tr><th className="py-2 pr-3">Товар / тариф</th><th className="py-2 text-right">Доступно</th></tr>
        </thead>
        <tbody>
          {data.slice(0, 15).map((entry) => (
            <tr key={entry.planId} className="border-t border-border">
              <td className="py-3 pr-3">
                <Link className="font-medium underline-offset-4 hover:underline" href={`/stock?planId=${encodeURIComponent(entry.planId)}`}>
                  {entry.productTitle}
                </Link>
                <p className="text-xs text-muted-foreground">{entry.planTitle}</p>
              </td>
              <td className="py-3 text-right tabular-nums">
                <span className={entry.available <= entry.threshold ? 'font-semibold text-destructive' : ''}>{entry.available}</span>
                {entry.available <= entry.threshold && <p className="text-xs text-muted-foreground">Минимум: {entry.threshold}</p>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
