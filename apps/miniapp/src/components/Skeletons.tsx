export function Skeleton({ className = '' }: { className?: string }): JSX.Element {
  return <div className={`skeleton rounded-card ${className}`} aria-hidden="true" />
}

export function ProductCardSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="aspect-square w-full" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  )
}

export function CategoryChipSkeleton(): JSX.Element {
  return <Skeleton className="h-9 w-20 shrink-0 rounded-full" />
}

export function ListRowSkeleton(): JSX.Element {
  return (
    <div className="flex items-center gap-3 p-3">
      <Skeleton className="h-12 w-12 shrink-0 rounded-lg" />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
  )
}
