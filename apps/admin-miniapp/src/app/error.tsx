'use client'

import { useEffect } from 'react'
import { ErrorState } from '@/components/States'

export default function GlobalError({ error, reset }: { error: Error; reset: () => void }): JSX.Element {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(error)
  }, [error])

  return (
    <div className="flex flex-1 items-center justify-center">
      <ErrorState title="Something went wrong" onRetry={reset} retryLabel="Retry" />
    </div>
  )
}
