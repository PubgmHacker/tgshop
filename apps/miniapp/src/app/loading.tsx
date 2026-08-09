export default function GlobalLoading(): JSX.Element {
  return (
    <div className="flex flex-1 flex-col gap-4 pt-4">
      <div className="mx-4 skeleton h-24 rounded-card" />
      <div className="mx-4 skeleton h-48 rounded-card" />
    </div>
  )
}
