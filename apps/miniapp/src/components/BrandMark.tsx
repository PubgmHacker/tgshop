'use client'

import Image from 'next/image'
import { useTheme } from '@/lib/ThemeProvider'

const TINTS: Record<string, string> = {
  'chatgpt-plus': '#10A37F',
  'claude-pro': '#D97757',
  midjourney: '#5B8DEF',
  'flux-pro': '#E0B060',
  'github-copilot': '#58A6FF',
  'cursor-pro': '#7EB8D4',
  mirasim: '#FFFFFF',
  chat: '#10A37F',
  image: '#5B8DEF',
  code: '#7EB8D4',
  all: '#F0C8A0'
}

const MARKS: Record<string, string | { dark: string; light: string }> = {
  'chatgpt-plus': '/brands/chatgpt.svg',
  'claude-pro': '/brands/claude.svg',
  midjourney: '/brands/midjourney.svg',
  'flux-pro': '/brands/flux.svg',
  'github-copilot': '/brands/copilot.svg',
  'cursor-pro': '/brands/cursor.svg',
  mirasim: { dark: '/brands/mirasim.png', light: '/brands/mirasim-black.png' }
}

export function tintFor(slug: string): string {
  return TINTS[slug] ?? '#A8B0BC'
}

function AllMark(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden>
      <g fill="none" stroke="#111" strokeWidth="2" strokeLinejoin="round">
        <rect x="3.5" y="4" width="17" height="16" rx="3" />
        <path d="M3.5 9h17" />
        <path d="M9 4v5" />
      </g>
    </svg>
  )
}

function FallbackMark({ slug }: { slug: string }): JSX.Element {
  const label =
    slug
      .replace(/[^a-z0-9]+/gi, '')
      .slice(0, 2)
      .toUpperCase() || '•'
  return <span className="text-[11px] font-bold tracking-tight text-black">{label}</span>
}

export function BrandMark({ slug, size = 32 }: { slug: string; size?: number }): JSX.Element {
  const { theme } = useTheme()
  if (slug === 'all') return <AllMark />

  const mark = MARKS[slug]
  const src = typeof mark === 'string' ? mark : mark?.[theme]
  if (!src) return <FallbackMark slug={slug} />

  return (
    <Image
      src={src}
      alt=""
      width={size}
      height={size}
      draggable={false}
      className="object-contain contrast-[1.12]"
      style={{ width: size, height: size }}
    />
  )
}
