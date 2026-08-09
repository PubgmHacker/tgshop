import { prisma } from '@tgshop/db'
import { createHttpExternalSupplier, type ExternalSupplier } from '@tgshop/core'

// The bot's EXTERNAL_API fulfilment adapter. The implementation lives in core
// (packages/core/src/supplier.ts) so apps/bot and apps/worker call one supplier
// rather than two that can drift; all this file does is bind it to the bot's
// Prisma client.
export const externalSupplier: ExternalSupplier = createHttpExternalSupplier(prisma)
