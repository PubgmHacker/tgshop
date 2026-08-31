import { PostSource, type BroadcastPost } from '@tgshop/db'
import { createPost } from './content.js'
import { env } from '../config/env.js'

interface NewProductDetails {
  title: string
  slug: string
  description: string
  imageUrl?: string | null
}

/**
 * Creates a reviewable announcement for a newly visible product.
 *
 * It deliberately creates an AGENT/DRAFT post instead of sending immediately:
 * an admin can correct copy, choose a narrower audience, attach media, and
 * explicitly queue the message from either admin surface. This keeps a catalog
 * typo from becoming an irreversible broadcast.
 */
export async function createNewProductBroadcastDraft(product: NewProductDetails): Promise<BroadcastPost> {
  const description = product.description.trim()
  const text = [
    '🆕 Новый товар в магазине',
    '',
    product.title.trim(),
    description,
    '',
    `Открыть товар: ${env.MINIAPP_URL.replace(/\/+$/, '')}/product/${encodeURIComponent(product.slug)}`
  ]
    .join('\n')
    .slice(0, 4096)

  return createPost({
    text,
    segment: 'all',
    mediaUrl: product.imageUrl ?? null,
    source: PostSource.AGENT
  })
}
