import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// Regression test for the second half of the 2026-08-25 outage: inside a
// @grammyjs/conversations v2 conversation the replay engine rebuilds context
// objects WITHOUT running outer middleware, so `ctx.session` is undefined at
// runtime even though the types say otherwise. topupConversation read
// `ctx.session.locale` directly and threw on the first resumed update.
//
// The fake `conversation` below reproduces the v2 contract precisely where it
// matters: external() hands its callback the OUTSIDE context (which has a
// session), while the conversation body's own ctx (inner) has none.
// ─────────────────────────────────────────────────────────────────────────────

const { mocks } = vi.hoisted(() => ({
  mocks: {
    getUserByTgId: vi.fn(),
    findOrCreateUser: vi.fn(),
    createInvoice: vi.fn(),
    newTopupReference: vi.fn(() => 'topup_ref_1'),
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
  }
}))

vi.mock('../domain/users.js', () => ({
  getUserByTgId: mocks.getUserByTgId,
  findOrCreateUser: mocks.findOrCreateUser
}))
vi.mock('../domain/payments.js', () => ({ createInvoice: mocks.createInvoice }))
vi.mock('../domain/topup.js', () => ({ newTopupReference: mocks.newTopupReference }))
vi.mock('../lib/logger.js', () => ({ logger: mocks.logger }))
// Keep the real enums (transitive imports read OrderStatus etc.); the Prisma
// client is lazy and never connects because every domain call is mocked above.
vi.mock('@tgshop/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tgshop/db')>()
  return { ...actual }
})

import { topupConversation } from '../bot/handlers/topup.js'
import type { BotContext } from '../bot/context.js'
import type { Conversation } from '@grammyjs/conversations'
import { t } from '../i18n/index.js'

function makeHarness(amountText: string) {
  // Outside context: session middleware ran here, locale is set.
  const outerCtx = { session: { locale: 'ru' as const } }

  // Inner context: rebuilt by the replay engine — NO session at runtime.
  const innerCtx = {
    session: undefined,
    from: { id: 9 },
    reply: vi.fn(async () => ({}))
  }

  const amountCtx = { message: { text: amountText } }

  const conversation = {
    // v2 contract: the callback receives the outside context object.
    external: vi.fn(async (op: (ctx: typeof outerCtx) => unknown) => op(outerCtx)),
    waitFor: vi.fn(async () => amountCtx)
  }

  return { conversation, innerCtx, outerCtx }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.newTopupReference.mockReturnValue('topup_ref_1')
})

describe('topupConversation', () => {
  it('runs with a session-less inner context, taking the locale from the outside one', async () => {
    const { conversation, innerCtx } = makeHarness('5')
    mocks.getUserByTgId.mockResolvedValue({ id: 'u1' })
    mocks.createInvoice.mockResolvedValue({ payUrl: 'https://pay.example/inv1' })

    await expect(
      topupConversation(
        conversation as unknown as Conversation<BotContext, BotContext>,
        innerCtx as unknown as BotContext
      )
    ).resolves.toBeUndefined()

    // The prompt used the OUTER session's locale, not a crashed inner read.
    expect(innerCtx.reply).toHaveBeenNthCalledWith(1, t('ru', 'topup.enter_amount'))
    expect(mocks.createInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', amountCents: 500, provider: 'CRYPTOBOT' })
    )
    expect(innerCtx.reply).toHaveBeenLastCalledWith(
      t('ru', 'topup.created', { amount: '$5.00' }),
      expect.objectContaining({ reply_markup: expect.anything() })
    )
  })

  it('rejects an out-of-range amount in the outside locale', async () => {
    const { conversation, innerCtx } = makeHarness('0.50')

    await topupConversation(
      conversation as unknown as Conversation<BotContext, BotContext>,
      innerCtx as unknown as BotContext
    )

    expect(innerCtx.reply).toHaveBeenLastCalledWith(
      t('ru', 'topup.invalid_amount', { min: '$1.00', max: '$5000.00' })
    )
    expect(mocks.createInvoice).not.toHaveBeenCalled()
  })
})
