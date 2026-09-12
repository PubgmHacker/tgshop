import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// One log line per document/API request (static chunks are excluded by the
// matcher). This is the only way to tell "the phone never reached the server"
// apart from "the phone runs a stale cached bundle" when a client reports
// «нет соединения»: a reachable phone shows up here, a cut-off one does not.
export function middleware(req: NextRequest): NextResponse {
  console.log(
    JSON.stringify({
      req: `${req.method} ${req.nextUrl.pathname}`,
      ua: (req.headers.get('user-agent') ?? '').slice(0, 90)
    })
  )
  const res = NextResponse.next()
  res.headers.set('x-mini-build', (process.env.RAILWAY_GIT_COMMIT_SHA ?? 'dev').slice(0, 7))
  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
}
