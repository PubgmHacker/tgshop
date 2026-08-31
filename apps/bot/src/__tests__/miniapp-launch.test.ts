import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// Regression tests for the «Нет соединения с сервером» incident (2026-08-25).
// Telegram opens reply-keyboard (KeyboardButton.web_app) launches WITHOUT
// initData — that button variant exists for the Telegram.WebApp.sendData flow.
// The customer miniapp therefore could never authenticate when opened from the
// reply keyboard and every screen rendered the network-error state, while the
// same phone ran other shops fine. initData IS passed to inline-keyboard
// web_app buttons and the ≡ chat menu button, so those are the only launch
// paths the bot may offer.
// ─────────────────────────────────────────────────────────────────────────────

const { mocks } = vi.hoisted(() => ({
  mocks: {
    findOrCreateUser: vi.fn()
  }
}))

vi.mock('../domain/users.js', () => ({
  findOrCreateUser: mocks.findOrCreateUser
}))

import { mainMenuKeyboard, openShopKeyboard } from '../bot/keyboards/menu.js'
import { registerStartHandler } from '../bot/handlers/start.js'
import { env } from '../config/env.js'
import { t } from '../i18n/index.js'
import type { Bot } from 'grammy'
import type { BotContext } from '../bot/context.js'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.findOrCreateUser.mockResolvedValue({ id: 'user-1' })
})

describe('mainMenuKeyboard', () => {
  it.each(['ru', 'en'] as const)('carries text-only buttons (%s)', (locale) => {
    const buttons = mainMenuKeyboard(locale).build().flat()

    expect(buttons).toHaveLength(6)
    for (const button of buttons) {
      expect(button).not.toHaveProperty('web_app')
    }
  })
})

describe('openShopKeyboard', () => {
  it('is a single inline web_app button pointing at the miniapp', () => {
    const rows = openShopKeyboard('ru').inline_keyboard

    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveLength(1)
    expect(rows[0]?.[0]).toMatchObject({
      text: t('ru', 'menu.open_miniapp'),
      // No RAILWAY_GIT_COMMIT_SHA in tests, so the URL passes through unversioned.
      web_app: { url: env.MINIAPP_URL }
    })
  })

  it('opens a requested product directly instead of dropping the deep-link intent', () => {
    const rows = openShopKeyboard('ru', 'mirasim').inline_keyboard

    expect(rows[0]?.[0]).toMatchObject({
      web_app: { url: `${env.MINIAPP_URL}/product/mirasim` }
    })
  })
})

describe('/start', () => {
  function runStart() {
    let handler: ((ctx: BotContext) => Promise<void>) | undefined
    const bot = {
      command: vi.fn((name: string, fn: (ctx: BotContext) => Promise<void>) => {
        if (name === 'start') handler = fn
      })
    }
    registerStartHandler(bot as unknown as Bot<BotContext>)
    if (!handler) throw new Error('start handler was not registered')
    const startHandler = handler

    const ctx = {
      from: { id: 7, username: 'u', first_name: 'U', language_code: 'ru' },
      match: '',
      session: { locale: 'ru' as const },
      reply: vi.fn(async () => ({})),
      api: { sendChatAction: vi.fn(async () => true) }
    }
    return { ctx, run: () => startHandler(ctx as unknown as BotContext) }
  }

  it('installs the text menu, then offers the miniapp via an inline web_app button', async () => {
    const { ctx, run } = runStart()

    await run()

    expect(ctx.reply).toHaveBeenCalledTimes(2)

    const [welcomeText, welcomeOpts] = ctx.reply.mock.calls[0] as unknown as [
      string,
      { reply_markup: { keyboard: Array<Array<Record<string, unknown>>> } }
    ]
    expect(welcomeText).toBe(t('ru', 'start.welcome', { shopName: 'AI Access Rage' }))
    for (const button of welcomeOpts.reply_markup.keyboard.flat()) {
      expect(button).not.toHaveProperty('web_app')
    }

    const [openText, openOpts] = ctx.reply.mock.calls[1] as unknown as [
      string,
      { reply_markup: { inline_keyboard: Array<Array<{ web_app?: { url: string } }>> } }
    ]
    expect(openText).toBe(t('ru', 'start.open_shop'))
    expect(openOpts.reply_markup.inline_keyboard[0]?.[0]?.web_app?.url).toBe(env.MINIAPP_URL)
  })

  it('preserves a product deep link in the miniapp button', async () => {
    const { ctx, run } = runStart()
    ctx.match = 'product_mirasim'

    await run()

    const [, openOpts] = ctx.reply.mock.calls[1] as unknown as [
      string,
      { reply_markup: { inline_keyboard: Array<Array<{ web_app?: { url: string } }>> } }
    ]
    expect(openOpts.reply_markup.inline_keyboard[0]?.[0]?.web_app?.url).toBe(
      `${env.MINIAPP_URL}/product/mirasim`
    )
  })
})
