'use client'

import { Button } from '../components/ui/button'

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto flex max-w-lg flex-col items-start gap-4 p-6">
      <h1 className="text-xl font-semibold">Не удалось загрузить раздел</h1>
      <p className="text-sm text-muted-foreground">Повторите попытку. Если ошибка сохраняется, проверьте подключение или войдите в аккаунт заново.</p>
      <Button onClick={reset}>Повторить</Button>
      <a href="/login" className="text-sm underline underline-offset-4">Вернуться ко входу</a>
    </div>
  )
}
