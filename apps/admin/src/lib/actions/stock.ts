'use server'

import { revalidatePath } from 'next/cache'
import { prisma, AdminRole, StockStatus } from '@tgshop/db'
import { encrypt } from '@tgshop/core'
import { requireRole } from '../rbac'
import { writeAuditLog } from '../audit'
import {
  stockBulkPasteSchema,
  stockCsvImportSchema,
  type StockBulkPasteInput,
  type StockCsvImportInput
} from '../schemas'

export interface StockImportResult {
  createdCount: number
}

export async function listStockAction(planId?: string) {
  await requireRole(AdminRole.SUPPORT)
  return prisma.stockItem.findMany({
    where: planId ? { planId } : undefined,
    orderBy: { createdAt: 'desc' },
    include: { plan: { include: { product: true } } },
    take: 500
  })
}

export async function stockSummaryAction() {
  await requireRole(AdminRole.SUPPORT)
  const grouped = await prisma.stockItem.groupBy({
    by: ['planId', 'status'],
    _count: { _all: true }
  })
  return grouped
}

/** One payload per line, pasted directly into a textarea. Each line is encrypted independently. */
export async function bulkPasteStockAction(input: StockBulkPasteInput): Promise<StockImportResult> {
  const session = await requireRole(AdminRole.ADMIN)
  const data = stockBulkPasteSchema.parse(input)

  const plan = await prisma.plan.findUnique({ where: { id: data.planId } })
  if (!plan) {
    throw new Error(`Plan not found: ${data.planId}`)
  }

  const rows = data.payloads.map((payload) => ({
    planId: data.planId,
    payloadEnc: encrypt(payload),
    status: StockStatus.AVAILABLE
  }))

  const result = await prisma.stockItem.createMany({ data: rows })

  await writeAuditLog({
    actorId: session.adminId,
    action: 'stock.bulkPaste',
    entity: 'Plan',
    entityId: data.planId,
    diff: { createdCount: result.count }
  })

  revalidatePath('/stock')
  return { createdCount: result.count }
}

/**
 * CSV import: one payload per line (a "payload" column header is optional and
 * skipped if present; otherwise every non-empty line is treated as a payload).
 * Basic CSV: no quoting/escaping support beyond plain lines, matching the
 * simple "one secret per line" shape stock payloads take in this store.
 */
export async function csvImportStockAction(input: StockCsvImportInput): Promise<StockImportResult> {
  const session = await requireRole(AdminRole.ADMIN)
  const data = stockCsvImportSchema.parse(input)

  const plan = await prisma.plan.findUnique({ where: { id: data.planId } })
  if (!plan) {
    throw new Error(`Plan not found: ${data.planId}`)
  }

  const lines = data.csv
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const firstLine = lines[0]?.toLowerCase()
  const hasHeader = firstLine === 'payload' || firstLine === 'code' || firstLine === 'value'
  const payloadLines = hasHeader ? lines.slice(1) : lines

  if (payloadLines.length === 0) {
    throw new Error('CSV import contained no payload rows')
  }
  if (payloadLines.length > 5000) {
    throw new Error('CSV import exceeds the 5000-row limit per batch')
  }

  const rows = payloadLines.map((payload) => ({
    planId: data.planId,
    payloadEnc: encrypt(payload),
    status: StockStatus.AVAILABLE
  }))

  const result = await prisma.stockItem.createMany({ data: rows })

  await writeAuditLog({
    actorId: session.adminId,
    action: 'stock.csvImport',
    entity: 'Plan',
    entityId: data.planId,
    diff: { createdCount: result.count }
  })

  revalidatePath('/stock')
  return { createdCount: result.count }
}

export async function deleteStockItemAction(id: string) {
  const session = await requireRole(AdminRole.OWNER)
  const item = await prisma.stockItem.findUnique({ where: { id } })
  if (!item) return
  if (item.status !== StockStatus.AVAILABLE) {
    throw new Error('Cannot delete a stock item that is reserved or sold')
  }
  await prisma.stockItem.delete({ where: { id } })
  await writeAuditLog({ actorId: session.adminId, action: 'stock.delete', entity: 'StockItem', entityId: id })
  revalidatePath('/stock')
}
