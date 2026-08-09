import { EmptyState } from '@/components/States'

export default function NotFound(): JSX.Element {
  return (
    <div className="flex flex-1 items-center justify-center">
      <EmptyState icon="🔍" title="Not found" />
    </div>
  )
}
