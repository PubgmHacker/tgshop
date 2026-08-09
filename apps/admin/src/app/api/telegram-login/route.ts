import { NextResponse, type NextRequest } from 'next/server'
import { telegramLoginAction } from '../../../lib/actions/auth'

/**
 * Landing point for the Telegram Login Widget's `data-auth-url` redirect.
 *
 * The widget sends the browser here with the signed payload in the query
 * string, so this has to be a GET a top-level navigation can reach — which is
 * why `middleware.ts` lists `/api/telegram-login` as public. It is not an open
 * door: `telegramLoginAction()` re-derives the HMAC with the bot token and
 * refuses anything that does not both verify and already have an `AdminUser`
 * row at `tg:<telegram_id>`.
 *
 * There is deliberately no `next` parameter. Telegram signs the query string it
 * sends, so any extra parameter of ours would be folded into the
 * data_check_string and break the very signature we are checking.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const payload: Record<string, unknown> = {}
  // Every parameter Telegram sent, verbatim — the data_check_string covers all
  // of them, so hand-picking the fields we know about would break the day
  // Telegram adds one. `id` and `auth_date` are numbers in the widget's own
  // payload and text once they have been through a query string.
  for (const [key, value] of request.nextUrl.searchParams.entries()) {
    payload[key] = key === 'id' || key === 'auth_date' ? Number(value) : value
  }

  const result = await telegramLoginAction(payload)

  // 303: this was a navigation, and the follow-up must be a GET regardless of
  // how the browser got here.
  if (!result.ok) {
    return NextResponse.redirect(new URL('/login?error=telegram', request.url), 303)
  }
  return NextResponse.redirect(new URL('/', request.url), 303)
}
