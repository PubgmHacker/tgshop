import { describe, it, expect, vi, beforeEach } from 'vitest'

// Command menus are pure Telegram API calls made once at boot. The invariants
// worth pinning: the default scope gets the public list (with the ru
// translation), every admin chat gets the full admin list, and no failure —
// network or "chat not found" for an admin who never started the bot —
// escapes to crash the boot path.

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

vi.mock('../lib/logger.js', () => ({ logger: mockLogger }))

import { registerBotCommands, PUBLIC_COMMANDS, ADMIN_COMMANDS } from '../bot/commands.js'
import type { Bot } from 'grammy'
import type { BotContext } from '../bot/context.js'

function makeBot() {
  return { api: { setMyCommands: vi.fn(async () => true) } }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('registerBotCommands', () => {
  it('publishes the public menu (default + ru) and one admin menu per admin chat', async () => {
    const bot = makeBot()

    await registerBotCommands(bot as unknown as Bot<BotContext>, [42n, 99n])

    expect(bot.api.setMyCommands).toHaveBeenCalledWith(PUBLIC_COMMANDS.en)
    expect(bot.api.setMyCommands).toHaveBeenCalledWith(PUBLIC_COMMANDS.ru, { language_code: 'ru' })
    expect(bot.api.setMyCommands).toHaveBeenCalledWith(ADMIN_COMMANDS, {
      scope: { type: 'chat', chat_id: 42 }
    })
    expect(bot.api.setMyCommands).toHaveBeenCalledWith(ADMIN_COMMANDS, {
      scope: { type: 'chat', chat_id: 99 }
    })
    expect(bot.api.setMyCommands).toHaveBeenCalledTimes(4)
    expect(mockLogger.warn).not.toHaveBeenCalled()
  })

  it('keeps going when one admin chat is unknown to Telegram', async () => {
    const bot = makeBot()
    bot.api.setMyCommands
      .mockResolvedValueOnce(true) // public en
      .mockResolvedValueOnce(true) // public ru
      .mockRejectedValueOnce(new Error('Bad Request: chat not found')) // admin 42
      .mockResolvedValueOnce(true) // admin 99

    await expect(
      registerBotCommands(bot as unknown as Bot<BotContext>, [42n, 99n])
    ).resolves.toBeUndefined()

    expect(bot.api.setMyCommands).toHaveBeenCalledTimes(4)
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ adminId: '42' }),
      'failed to set admin bot commands'
    )
  })

  it('logs and continues when the public menu cannot be set at all', async () => {
    const bot = makeBot()
    bot.api.setMyCommands.mockRejectedValueOnce(new Error('network down'))

    await expect(registerBotCommands(bot as unknown as Bot<BotContext>, [])).resolves.toBeUndefined()

    // The en call threw, so the ru call inside the same guard is skipped.
    expect(bot.api.setMyCommands).toHaveBeenCalledTimes(1)
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.anything(), 'failed to set public bot commands')
  })
})
