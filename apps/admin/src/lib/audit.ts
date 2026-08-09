import { prisma, type Prisma } from '@tgshop/db'

export interface AuditLogInput {
  actorId: string
  action: string
  entity: string
  entityId: string
  diff?: Prisma.InputJsonValue
}

/** Writes an AuditLog row. Must be called for every mutating admin action, after the mutation succeeds (ideally in the same transaction). */
export async function writeAuditLog(
  input: AuditLogInput,
  tx: Pick<typeof prisma, 'auditLog'> = prisma
): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorType: 'admin',
      actorId: input.actorId,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      diff: input.diff ?? undefined
    }
  })
}
