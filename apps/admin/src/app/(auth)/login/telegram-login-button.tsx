'use client'

import { useEffect, useRef } from 'react'
import { Label } from '../../../components/ui/label'
import { t } from '../../../lib/i18n'

/** Pinned widget revision, per core.telegram.org/widgets/login. */
const WIDGET_SRC = 'https://telegram.org/js/telegram-widget.js?22'

/**
 * The official Telegram Login Widget.
 *
 * The widget is delivered as a <script> that reads its own `data-*` attributes
 * through `document.currentScript` and then replaces itself with an <iframe>
 * hosted by Telegram. That rules out writing it as JSX twice over: React would
 * render the tag without executing it, and even if it executed, `currentScript`
 * is null for anything React inserts. So it is appended imperatively, and the
 * cleanup empties the container — otherwise React 18's double-mount in strict
 * mode leaves two buttons stacked.
 *
 * `data-auth-url` sends the browser to our route handler with the signed
 * payload attached; the origin is read off the live page rather than configured,
 * so it always matches the host the operator actually opened. Telegram only
 * honours it if that domain is the one linked to the bot via BotFather's
 * /setdomain, which is the operator-side half of this setup.
 */
export function TelegramLoginButton({ botUsername }: { botUsername: string }) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const script = document.createElement('script')
    script.src = WIDGET_SRC
    script.async = true
    script.setAttribute('data-telegram-login', botUsername)
    script.setAttribute('data-size', 'large')
    script.setAttribute('data-radius', '8')
    script.setAttribute('data-userpic', 'false')
    script.setAttribute('data-auth-url', `${window.location.origin}/api/telegram-login`)
    container.appendChild(script)

    return () => {
      container.replaceChildren()
    }
  }, [botUsername])

  return (
    <div className="flex flex-col gap-2">
      <Label>{t('auth.login.telegram')}</Label>
      <div ref={containerRef} className="flex min-h-[40px] justify-center" />
    </div>
  )
}
