'use client'

import { useEffect, useState } from 'react'

export interface Countdown {
  /** Milliseconds until `expiresAt`, never negative. */
  remainingMs: number
  /** True once a real deadline has passed; false while there is no deadline. */
  isExpired: boolean
  /** `mm:ss`, or `h:mm:ss` past an hour. */
  label: string
}

function remainingUntil(expiresAt: string | null | undefined): number {
  if (!expiresAt) return 0
  const target = Date.parse(expiresAt)
  if (!Number.isFinite(target)) return 0
  return Math.max(0, target - Date.now())
}

function formatRemaining(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const mmss = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  return hours > 0 ? `${hours}:${mmss}` : mmss
}

/**
 * Ticks once a second towards an ISO deadline (a payment window). The screen
 * decides what "expired" looks like; this only keeps the clock honest across
 * re-renders and stops ticking once the deadline has passed.
 */
export function useCountdown(expiresAt: string | null | undefined): Countdown {
  const [remainingMs, setRemainingMs] = useState(() => remainingUntil(expiresAt))

  useEffect(() => {
    setRemainingMs(remainingUntil(expiresAt))
    if (!expiresAt) return
    const timer = window.setInterval(() => {
      const next = remainingUntil(expiresAt)
      setRemainingMs(next)
      if (next === 0) window.clearInterval(timer)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [expiresAt])

  return {
    remainingMs,
    isExpired: Boolean(expiresAt) && remainingMs === 0,
    label: formatRemaining(remainingMs)
  }
}
