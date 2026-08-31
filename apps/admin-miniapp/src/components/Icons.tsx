'use client'

import type { SVGProps } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// Hand-rolled 24px outline icon set (1.7px stroke), replacing emoji across the
// app. Every icon inherits currentColor so the theme drives the tint.
// ─────────────────────────────────────────────────────────────────────────────

export type IconName =
  | 'home'
  | 'grid'
  | 'user'
  | 'settings'
  | 'plus'
  | 'crown'
  | 'users'
  | 'wallet'
  | 'star'
  | 'sun'
  | 'moon'
  | 'search'
  | 'copy'
  | 'check'
  | 'chevron-left'
  | 'chevron-right'
  | 'close'
  | 'box'
  | 'bag'
  | 'support'
  | 'globe'
  | 'clock'
  | 'shield'
  | 'code'
  | 'card'
  | 'send'
  | 'refresh'
  | 'alert'

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName
  size?: number
}

const PATHS: Record<IconName, JSX.Element> = {
  home: (
    <>
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6 9.5V20h12V9.5" />
      <path d="M10 20v-5h4v5" />
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="2" />
      <rect x="13" y="4" width="7" height="7" rx="2" />
      <rect x="4" y="13" width="7" height="7" rx="2" />
      <rect x="13" y="13" width="7" height="7" rx="2" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c.8-3.4 3.6-5 7-5s6.2 1.6 7 5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.8 13.4 5a7.2 7.2 0 0 1 2.5 1l2.5-.7 1.4 2.4-1.7 2a7.3 7.3 0 0 1 0 2.7l1.7 2-1.4 2.4-2.5-.7a7.2 7.2 0 0 1-2.5 1L12 21.2 10.6 19a7.2 7.2 0 0 1-2.5-1l-2.5.7-1.4-2.4 1.7-2a7.3 7.3 0 0 1 0-2.7l-1.7-2 1.4-2.4 2.5.7a7.2 7.2 0 0 1 2.5-1L12 2.8Z" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  crown: (
    <>
      <path d="M4 8.5 8 12l4-6 4 6 4-3.5-1.5 9.5h-13L4 8.5Z" />
      <path d="M7 21h10" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3.5 19c.7-3 2.9-4.5 5.5-4.5s4.8 1.5 5.5 4.5" />
      <path d="M15.5 5.9a3 3 0 1 1 1.2 5.8" />
      <path d="M17.4 14.7c1.7.5 2.8 1.9 3.1 4" />
    </>
  ),
  wallet: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="3" />
      <path d="M3 10h18" />
      <path d="M15.5 15h2" />
    </>
  ),
  star: (
    <>
      <path d="m12 3.5 2.5 5.2 5.7.7-4.2 4 1.1 5.6-5.1-2.8-5.1 2.8 1.1-5.6-4.2-4 5.7-.7L12 3.5Z" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M21.5 12h-2M4.5 12h-2M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4M18.7 18.7l-1.4-1.4M6.7 6.7 5.3 5.3" />
    </>
  ),
  moon: (
    <>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-3.8-3.8" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15" />
    </>
  ),
  check: (
    <>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </>
  ),
  'chevron-left': (
    <>
      <path d="m14.5 5.5-6.5 6.5 6.5 6.5" />
    </>
  ),
  'chevron-right': (
    <>
      <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />
    </>
  ),
  close: (
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </>
  ),
  box: (
    <>
      <path d="M4 8.2 12 4l8 4.2v7.6L12 20l-8-4.2V8.2Z" />
      <path d="M4 8.2 12 12l8-3.8" />
      <path d="M12 12v8" />
    </>
  ),
  bag: (
    <>
      <path d="M5.5 8.5h13l-.9 11a2 2 0 0 1-2 1.9H8.4a2 2 0 0 1-2-1.9l-.9-11Z" />
      <path d="M8.8 8.5V7a3.2 3.2 0 0 1 6.4 0v1.5" />
    </>
  ),
  support: (
    <>
      <path d="M5 12a7 7 0 0 1 14 0" />
      <rect x="3.5" y="12" width="4" height="6" rx="2" />
      <rect x="16.5" y="12" width="4" height="6" rx="2" />
      <path d="M19 18v.8a2.2 2.2 0 0 1-2.2 2.2H13" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17" />
      <path d="M12 3.5c2.6 2.3 3.9 5.1 3.9 8.5s-1.3 6.2-3.9 8.5c-2.6-2.3-3.9-5.1-3.9-8.5s1.3-6.2 3.9-8.5Z" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2.5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.5 19 6v5.5c0 4.3-2.8 7.6-7 9-4.2-1.4-7-4.7-7-9V6l7-2.5Z" />
      <path d="m9 12 2.2 2.2L15.5 9.8" />
    </>
  ),
  code: (
    <>
      <path d="m8.5 8-4 4 4 4" />
      <path d="m15.5 8 4 4-4 4" />
      <path d="m13 5-2 14" />
    </>
  ),
  card: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="3" />
      <path d="M3 10h18" />
      <path d="M6.5 14.5H11" />
    </>
  ),
  send: (
    <>
      <path d="m3.5 4.5 17 7.5-17 7.5 3.2-6.2L14 12 6.7 10.7 3.5 4.5Z" />
      <path d="M6.7 10.7 3.5 4.5M6.7 13.3 3.5 19.5" />
    </>
  ),
  refresh: (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M19.5 3.5v3.7h-3.7" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4 21 19.5H3L12 4Z" />
      <path d="M12 10v4" />
      <path d="M12 17.2v.1" />
    </>
  )
}

export function Icon({ name, size = 20, ...rest }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {PATHS[name]}
    </svg>
  )
}
