import type { FastifyRequest } from 'fastify'
import { prisma, type Prisma } from '@tgshop/db'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers shared by the /api/admin routes.
// ─────────────────────────────────────────────────────────────────────────────

/** The acting admin's Telegram id (string form) for audit rows. */
export function adminActorId(req: FastifyRequest): string {
  return req.auth?.tgId ?? 'unknown'
}

/**
 * Records WHO did an admin write. Every mutating /api/admin route calls this
 * after its transaction commits, so the audit timeline stays the single place
 * an operator reconstructs "what changed and by whom".
 */
export async function writeAdminAudit(
  req: FastifyRequest,
  action: string,
  entity: string,
  entityId: string,
  diff?: Prisma.InputJsonValue
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorType: 'admin',
      actorId: adminActorId(req),
      action,
      entity,
      entityId,
      ...(diff !== undefined ? { diff } : {})
    }
  })
}

/**
 * Prisma known-request-error code (P2002, P2003, P2025, …) without importing
 * the error class — duck-typed so it also matches errors crossing package
 * boundaries where instanceof can fail.
 */
export function prismaErrorCode(err: unknown): string | null {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code
    if (typeof code === 'string' && /^P\d{4}$/.test(code)) return code
  }
  return null
}
