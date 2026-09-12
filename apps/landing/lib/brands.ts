import type { LandingProduct } from './i18n'

// Brand marks bundled with the landing. A known brand renders from our own
// origin, so the showcase never depends on a vendor's host being up or on its
// cache headers; the API's `imageUrl` stays the fallback for everything else.
const LOCAL_MARKS: Record<string, string> = {
  mirasim: '/brands/mirasim.png'
}

export function brandMarkUrl(product: Pick<LandingProduct, 'slug' | 'imageUrl'>): string | null {
  const local = product.slug ? LOCAL_MARKS[product.slug] : undefined
  return local ?? product.imageUrl ?? null
}
