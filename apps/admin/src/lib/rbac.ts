import { AdminRole, prisma } from '@tgshop/db'
import { getSession, type SessionPayload } from './session'

export class UnauthorizedError extends Error {
  constructor(message = 'Not authenticated') {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

export class ForbiddenError extends Error {
  constructor(message = 'Insufficient role for this action') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

const ROLE_RANK: Record<AdminRole, number> = {
  [AdminRole.SUPPORT]: 0,
  [AdminRole.ADMIN]: 1,
  [AdminRole.OWNER]: 2
}

/** Throws UnauthorizedError if there is no valid session; otherwise returns it. Call at the top of every server action / route handler. */
export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession()
  if (!session) {
    throw new UnauthorizedError()
  }
  const admin = await prisma.adminUser.findUnique({ where: { id: session.adminId }, select: { role: true, email: true } })
  if (!admin) throw new UnauthorizedError()
  return { ...session, role: admin.role, email: admin.email }
}

/**
 * Throws ForbiddenError unless the current session's role is at least `minRole`
 * in the OWNER > ADMIN > SUPPORT hierarchy. Must be called server-side inside every
 * mutating server action / route handler — never trust client-side role checks alone.
 */
export async function requireRole(minRole: AdminRole): Promise<SessionPayload> {
  const session = await requireSession()
  if (ROLE_RANK[session.role] < ROLE_RANK[minRole]) {
    throw new ForbiddenError(`Requires role >= ${minRole}, session has ${session.role}`)
  }
  return session
}

export function hasRole(role: AdminRole, minRole: AdminRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minRole]
}
