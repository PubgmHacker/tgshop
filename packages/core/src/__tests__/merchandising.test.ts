import { describe, expect, it } from 'vitest'
import { mirasimAnnouncement, mirasimProductLink, prioritizeCatalog, prioritizeProducts, productPromotion } from '../merchandising.js'

describe('featured catalog merchandising', () => {
  it('pins Mirasim while preserving all other products and their relative order', () => {
    const products = [{ slug: 'alpha', sortOrder: 0 }, { slug: 'beta', sortOrder: 1 }, { slug: 'mirasim', sortOrder: 999 }, { slug: 'gamma', sortOrder: 2 }]
    const sorted = prioritizeProducts(products)
    expect(sorted.map(p => p.slug)).toEqual(['mirasim', 'alpha', 'beta', 'gamma'])
    expect(products.map(p => p.slug)).toEqual(['alpha', 'beta', 'mirasim', 'gamma'])
    expect(sorted[0]).toBe(products[2])
  })

  it('puts Mirasim first when a grouped catalog is flattened', () => {
    const categories = [{ id: 'chat', products: [{ slug: 'alpha' }] }, { id: 'code', products: [{ slug: 'beta' }, { slug: 'mirasim' }] }]
    const result = prioritizeCatalog(categories)
    expect(result.flatMap(c => c.products).map(p => p.slug)).toEqual(['mirasim', 'beta', 'alpha'])
    expect(categories[0]?.id).toBe('chat')
    expect(categories[1]?.products[0]?.slug).toBe('beta')
  })

  it('keeps unfeatured and empty catalogs unchanged', () => {
    expect(prioritizeProducts([])).toEqual([])
    const products = [{ slug: 'other' }, { slug: 'mirasim-alternative' }]
    expect(prioritizeProducts(products)).toEqual(products)
    expect(productPromotion('mirasim-alternative')).toBeNull()
  })

  it('ties limited access to cloud Pro and explains free own-account use', () => {
    expect(productPromotion('mirasim')).toMatchObject({ featured: true, isNew: true, limited: true })
    expect(productPromotion('mirasim')?.accessNote.ru).toContain('по приглашениям')
    expect(productPromotion('mirasim')?.accessNote.ru).toContain('бесплатна')
  })

  it('preserves the product intent in the Telegram entry link', () => {
    expect(mirasimProductLink('https://shop.example/', '@example_bot')).toBe('https://t.me/example_bot?start=product_mirasim')
    expect(mirasimProductLink('https://shop.example/', 'bad/name')).toBe('https://shop.example/product/mirasim')
  })

  it.each(['ru', 'en'] as const)('makes a reviewable %s announcement without fabricated prices or scarcity', locale => {
    const url = 'https://t.me/example_bot?start=product_mirasim'
    const text = mirasimAnnouncement(url, locale)
    expect(text.startsWith('Mirasim Pro')).toBe(true)
    expect(text).toContain(url)
    expect(text).not.toMatch(/\$|\b\d+\b|лучше всех|best in the world/i)
    expect(text.length).toBeLessThan(4096)
  })
})
