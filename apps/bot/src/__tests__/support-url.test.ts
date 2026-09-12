import { describe, expect, it } from 'vitest'
import { resolveSupportUrl } from '../lib/support-url.js'

describe('support destination', () => {
  it('routes the legacy seed placeholder to this shop’s FAQ', () => {
    expect(resolveSupportUrl('https://t.me/tgshop_support', 'https://shop.example/')).toBe('https://shop.example/#faq')
  })

  it.each(['https://t.me/actual_shop_support', 'https://help.example/contact'])('preserves the operator contact %s', (url) => {
    expect(resolveSupportUrl(url, 'https://shop.example/')).toBe(url)
  })
})
