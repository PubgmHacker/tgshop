import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PostSource, PostStatus, type Product } from '@tgshop/db'

const { createPost } = vi.hoisted(() => ({ createPost: vi.fn() }))
vi.mock('../domain/content.js', () => ({ createPost }))
vi.mock('../config/redis.js', () => ({ redis: {} }))

import { createNewProductBroadcastDraft } from '../domain/new-product-broadcast.js'
import { categoriesKeyboard, productsKeyboard } from '../bot/keyboards/catalog.js'

beforeEach(() => {
  createPost.mockReset()
  createPost.mockImplementation(async input => ({ ...input, id: 'draft-fixture', status: PostStatus.DRAFT }))
})

describe('Mirasim promotion in Telegram', () => {
  it('puts the featured product above category navigation', () => {
    const keyboard = categoriesKeyboard([], { slug: 'mirasim', title: 'Mirasim' }, 'ru').inline_keyboard
    expect(keyboard[0]?.[0]).toMatchObject({ text: expect.stringContaining('Новинка'), callback_data: 'prod:mirasim' })
  })

  it('pins Mirasim in category product buttons even when the input order differs', () => {
    const products = [{ slug: 'other', title: 'Other' }, { slug: 'mirasim', title: 'Mirasim' }] as Product[]
    const keyboard = productsKeyboard('en', 'code', products).inline_keyboard
    expect(keyboard[0]?.[0]).toMatchObject({ callback_data: 'prod:mirasim', text: expect.stringContaining('Invite-only Pro') })
    expect(keyboard[1]?.[0]).toMatchObject({ callback_data: 'prod:other' })
  })

  it('creates a featured announcement as a draft with no schedule', async () => {
    const post = await createNewProductBroadcastDraft({ title: 'Mirasim', slug: 'mirasim', description: 'IDE' })
    expect(post.status).toBe(PostStatus.DRAFT)
    expect(createPost).toHaveBeenCalledWith(expect.objectContaining({ source: PostSource.AGENT, text: expect.stringContaining('выбор') }))
    const input = createPost.mock.calls[0]?.[0]
    expect(input?.scheduledAt).toBeUndefined()
    expect(input?.text).toContain('product_mirasim')
    expect(input?.text).toContain('по приглашениям')
  })

  it('leaves ordinary product announcements unfeatured', async () => {
    await createNewProductBroadcastDraft({ title: 'Other', slug: 'other', description: 'Other product details' })
    const input = createPost.mock.calls[0]?.[0]
    expect(input?.text).toContain('Other product details')
    expect(input?.text).not.toContain('Mirasim')
  })
})
