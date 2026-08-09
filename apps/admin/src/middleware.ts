import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifySessionToken, SESSION_COOKIE_NAME } from './lib/session-token'

/**
 * Route protection: any request outside /login (and static/api auth routes)
 * requires a valid signed session cookie. RBAC per-action is still enforced
 * server-side inside every server action/route handler — this middleware only
 * gates "logged in at all", not role.
 *
 * Middleware always runs in the Edge runtime, so the signature check uses the
 * Web Crypto verifier from `session-token.ts` rather than the `node:crypto`
 * helpers in `session.ts`. A missing SESSION_SECRET fails closed (redirect to
 * /login) instead of letting the request through unverified.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  const isPublic =
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/telegram-login') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon')

  if (isPublic) {
    return NextResponse.next()
  }

  const cookieValue = request.cookies.get(SESSION_COOKIE_NAME)?.value
  const session = await verifySessionToken(cookieValue, process.env.SESSION_SECRET)

  if (!session) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
}
