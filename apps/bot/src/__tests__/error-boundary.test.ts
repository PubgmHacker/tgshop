import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// Regression tests for the production outage of 2026-08-25: Telegram delivered
// a chat-less update (pre_checkout_query), grammY's default session key
// (chat.id) was undefined, so ctx.session was undefined and the first
// `.locale` access threw. In webhook mode grammY does NOT route errors to
// bot.catch — the throw became the route's HTTP 500 and Telegram retried the
// same poisoned update forever, stalling every chat behind it.
//
// Two invariants are pinned here:
//   1. sessionKey() falls back to from.id, so payment updates keep a session.
//   2. errorBoundary() swallows middleware errors (webhook then answers 200),
//      reports them, and still answers a pending pre_checkout_query.
// ─────────────────────────────────────────────────────────────────────────────

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), fatal: vi.fn() }
}))

vi.mock('../lib/logger.js', () => ({ logger: mockLogger }))
vi.mock('../config/env.js', () => ({ env: { ADMIN_IDS: ['42'] } }))

import { sessionKey } from '../bot/context.js'
import { errorBoundary } from '../bot/middleware/errorHandler.js'
import type { BotContext } from '../bot/context.js'
import { t } from '../i18n/index.js'

interface FakeCtxInit {
  chat?: { id: number }
  from?: { id: number }
  preCheckoutQuery?: { id: string }
  session?: { locale: 'en' | 'ru' }
}

function makeCtx(init: FakeCtxInit) {
  const ctx = {
    update: { update_id: 100500 },
    chat: init.chat,
    from: init.from,
    preCheckoutQuery: init.preCheckoutQuery,
    session: init.session,
    reply: vi.fn(async () => ({})),
    answerPreCheckoutQuery: vi.fn(async () => true),
    api: { sendMessage: vi.fn(async () => ({})) }
  }
  return ctx
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('sessionKey', () => {
  it('keys regular chat updates by chat id', () => {
    expect(sessionKey({ chat: { id: 777 }, from: { id: 111 } })).toBe('777')
  })

  it('falls back to the sender id for chat-less updates (pre_checkout_query)', () => {
    expect(sessionKey({ from: { id: 111 } })).toBe('111')
  })

  it('returns undefined only when neither chat nor sender exists', () => {
    expect(sessionKey({})).toBeUndefined()
  })
})

describe('errorBoundary', () => {
  it('passes through when downstream middleware succeeds', async () => {
    const ctx = makeCtx({ chat: { id: 1 }, session: { locale: 'en' } })
    const next = vi.fn(async () => undefined)

    await errorBoundary(ctx as unknown as BotContext, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(mockLogger.error).not.toHaveBeenCalled()
    expect(ctx.reply).not.toHaveBeenCalled()
  })

  it('swallows downstream errors, logs them and replies to the chat', async () => {
    const ctx = makeCtx({ chat: { id: 1 }, session: { locale: 'ru' } })
    const boom = new TypeError("Cannot read properties of undefined (reading 'locale')")

    // Must NOT rethrow — a rethrow becomes the webhook route's 500.
    await expect(
      errorBoundary(ctx as unknown as BotContext, async () => {
        throw boom
      })
    ).resolves.toBeUndefined()

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: boom, updateId: 100500 }),
      'unhandled bot error'
    )
    expect(ctx.reply).toHaveBeenCalledWith(t('ru', 'errors.generic'))
    expect(ctx.api.sendMessage).toHaveBeenCalledWith(42, expect.stringContaining(boom.message))
  })

  it('answers a failed pre_checkout_query instead of leaving the payment sheet hanging', async () => {
    const ctx = makeCtx({ from: { id: 9 }, preCheckoutQuery: { id: 'q1' } })

    await errorBoundary(ctx as unknown as BotContext, async () => {
      throw new Error('checkout blew up')
    })

    expect(ctx.answerPreCheckoutQuery).toHaveBeenCalledWith(false, t('en', 'errors.generic'))
    expect(ctx.reply).not.toHaveBeenCalled()
  })

  it('survives an undefined session and a failing reply without throwing', async () => {
    const ctx = makeCtx({ chat: { id: 1 } })
    ctx.reply = vi.fn(async () => {
      throw new Error('reply failed too')
    })

    await expect(
      errorBoundary(ctx as unknown as BotContext, async () => {
        throw new Error('original failure')
      })
    ).resolves.toBeUndefined()

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'failed to send error reply to user'
    )
  })
})
