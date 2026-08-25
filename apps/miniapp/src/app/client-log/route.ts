// Target for the boot beacon (lib/TelegramProvider.tsx). The middleware has
// already logged the full query string by the time this runs — that log line
// IS the diagnostic — so the handler only answers something tiny and
// uncacheable.
export const dynamic = 'force-dynamic'

export function GET(): Response {
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
}
