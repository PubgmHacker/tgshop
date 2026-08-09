'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { t } from '../../../lib/i18n'

export function UsersSearch({ initialQuery }: { initialQuery: string }) {
  const router = useRouter()
  const [query, setQuery] = useState(initialQuery)

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    router.push(query.trim() ? `/users?q=${encodeURIComponent(query.trim())}` : '/users')
  }

  return (
    <form onSubmit={onSubmit} className="flex items-end gap-3 rounded-lg border border-border p-4">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="username, first name, user ID or Telegram ID"
        className="max-w-md"
        aria-label={t('common.search')}
      />
      <Button type="submit">{t('common.search')}</Button>
      {initialQuery && (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setQuery('')
            router.push('/users')
          }}
        >
          Reset
        </Button>
      )}
    </form>
  )
}
