'use server'

import { revalidatePath } from 'next/cache'
import { prisma, AdminRole, type Prisma } from '@tgshop/db'
import { requireRole } from '../rbac'
import { writeAuditLog } from '../audit'
import { settingUpsertSchema, parseSettingValue, type SettingUpsertInput } from '../schemas'

export async function listSettingsAction() {
  await requireRole(AdminRole.SUPPORT)
  return prisma.setting.findMany({ orderBy: { key: 'asc' } })
}

export async function upsertSettingAction(input: SettingUpsertInput) {
  const session = await requireRole(AdminRole.OWNER)
  const data = settingUpsertSchema.parse(input)

  // Shape check per known key (unknown keys pass through as arbitrary JSON).
  const validated = parseSettingValue(data.key, data.value)
  const value = (validated ?? null) as Prisma.InputJsonValue

  const setting = await prisma.setting.upsert({
    where: { key: data.key },
    update: { value },
    create: { key: data.key, value }
  })

  await writeAuditLog({
    actorId: session.adminId,
    action: 'setting.update',
    entity: 'Setting',
    entityId: data.key,
    diff: { value: validated } as unknown as Prisma.InputJsonValue
  })

  revalidatePath('/settings')
  return setting
}

export async function deleteSettingAction(key: string) {
  const session = await requireRole(AdminRole.OWNER)
  await prisma.setting.delete({ where: { key } })
  await writeAuditLog({ actorId: session.adminId, action: 'setting.delete', entity: 'Setting', entityId: key })
  revalidatePath('/settings')
}
