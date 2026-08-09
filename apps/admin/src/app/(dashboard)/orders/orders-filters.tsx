'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { Select } from '../../../components/ui/form'
import { t } from '../../../lib/i18n'

export interface OrderFilterValues {
  status: string
  provider: string
  userId: string
  query: string
  dateFrom: string
  dateTo: string
}

export function OrdersFilters({
  initial,
  statuses,
  providers
}: {
  initial: OrderFilterValues
  statuses: string[]
  providers: string[]
}) {
  const router = useRouter()
  const [values, setValues] = useState(initial)

  function set<K extends keyof OrderFilterValues>(key: K, value: OrderFilterValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(values)) {
      if (value) params.set(key, value)
    }
    const qs = params.toString()
    router.push(qs ? `/orders?${qs}` : '/orders')
  }

  function onReset() {
    setValues({ status: '', provider: '', userId: '', query: '', dateFrom: '', dateTo: '' })
    router.push('/orders')
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor="status">{t('common.status')}</Label>
        <Select id="status" value={values.status} onChange={(e) => set('status', e.target.value)}>
          <option value="">All</option>
          {statuses.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="provider">Provider</Label>
        <Select id="provider" value={values.provider} onChange={(e) => set('provider', e.target.value)}>
          <option value="">All</option>
          {providers.map((provider) => (
            <option key={provider} value={provider}>
              {provider}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="dateFrom">From (UTC)</Label>
        <Input id="dateFrom" type="date" value={values.dateFrom} onChange={(e) => set('dateFrom', e.target.value)} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="dateTo">To (UTC)</Label>
        <Input id="dateTo" type="date" value={values.dateTo} onChange={(e) => set('dateTo', e.target.value)} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="userId">User ID</Label>
        <Input id="userId" value={values.userId} onChange={(e) => set('userId', e.target.value)} className="w-48" />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="query">Order / external ID</Label>
        <Input id="query" value={values.query} onChange={(e) => set('query', e.target.value)} className="w-56" />
      </div>
      <Button type="submit">{t('common.search')}</Button>
      <Button type="button" variant="outline" onClick={onReset}>
        Reset
      </Button>
    </form>
  )
}
