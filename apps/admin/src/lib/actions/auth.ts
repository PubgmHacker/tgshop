'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { compare } from 'bcryptjs'
import { prisma } from '@tgshop/db'
import { loginSchema, telegramLoginSchema, type LoginInput } from '../schemas'
import { createSessionValue, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from '../session'
import { verifyTotp } from '../totp'
import { verifyTelegramLogin } from '../telegram-auth'
import { writeAuditLog } from '../audit'
import { getEnv } from '../env'
import { getRedis } from '../redis'
import { allowLoginAttempt } from '../login-limit'

export interface LoginResult {
  ok: boolean
  error?: string
}

/**
 * Email + password (+ optional TOTP) login. Always compares against a real
 * bcrypt hash (even for unknown emails, using a static dummy hash) to avoid
 * leaking account existence via response timing.
 */
export async function loginAction(input: LoginInput): Promise<LoginResult> {
  const parsed = loginSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: 'auth.login.error' }
  }
  const { email, password, totp } = parsed.data
  if (!(await allowLoginAttempt(getRedis(), email))) return { ok: false, error: 'auth.login.error' }

  const admin = await prisma.adminUser.findUnique({ where: { email } })

  // Dummy bcrypt hash of a random value, used to keep comparison timing constant
  // when the email does not exist, so we never short-circuit before the hash check.
  const DUMMY_HASH = '$2a$12$YCLBkg8CR69HyfrkMpc.1u3544wRss3iIr/x2/idNJSBiGko.sWDK'
  const passwordOk = await compare(password, admin?.passwordHash ?? DUMMY_HASH)

  if (!admin || !passwordOk) {
    return { ok: false, error: 'auth.login.error' }
  }

  if (admin.totpSecret) {
    if (!totp || !verifyTotp(admin.totpSecret, totp)) {
      return { ok: false, error: 'auth.login.error' }
    }
  }

  const value = createSessionValue(admin)
  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE_NAME, value, {
    httpOnly: true,
    secure: getEnv().NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS
  })

  await writeAuditLog({
    actorId: admin.id,
    action: 'admin.login',
    entity: 'AdminUser',
    entityId: admin.id
  })

  return { ok: true }
}

/**
 * Server-side verification + session issuance for the Telegram Login Widget.
 * Only succeeds if an AdminUser row exists whose email matches
 * `tg:<telegram_id>` (the convention used when provisioning Telegram-linked
 * admins — see `scripts/create-admin.mjs --telegram-id`) — this widget path
 * never creates new admins.
 *
 * Takes `unknown` on purpose: the payload arrives from the browser as a query
 * string, so a declared parameter type would be a claim, not a guarantee. The
 * Zod parse below is the only thing standing between the request and the HMAC
 * check, and it has to run before `verifyTelegramLogin()` can be trusted.
 */
export async function telegramLoginAction(payload: unknown): Promise<LoginResult> {
  const parsed = telegramLoginSchema.safeParse(payload)
  if (!parsed.success) {
    return { ok: false, error: 'auth.login.error' }
  }

  if (!verifyTelegramLogin(parsed.data)) {
    return { ok: false, error: 'auth.login.error' }
  }

  const linkedEmail = `tg:${parsed.data.id}`
  const admin = await prisma.adminUser.findUnique({ where: { email: linkedEmail } })
  if (!admin || admin.totpSecret) {
    return { ok: false, error: 'auth.login.error' }
  }

  const value = createSessionValue(admin)
  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE_NAME, value, {
    httpOnly: true,
    secure: getEnv().NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS
  })

  await writeAuditLog({
    actorId: admin.id,
    action: 'admin.login.telegram',
    entity: 'AdminUser',
    entityId: admin.id
  })

  return { ok: true }
}

export async function logoutAction(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE_NAME)
  redirect('/login')
}
