'use client'

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

/** Renders a TRC-20 payment URI as a QR code (client-side, no network dependency). */
export function QrCode({ value, size = 200 }: { value: string; size?: number }): JSX.Element {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    QRCode.toDataURL(value, { width: size, margin: 1, color: { dark: '#000000', light: '#ffffff' } })
      .then((url) => {
        if (!cancelled) setDataUrl(url)
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [value, size])

  if (!dataUrl) {
    return <div className="skeleton rounded-card" style={{ width: size, height: size }} />
  }

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={dataUrl} alt="QR code" width={size} height={size} className="rounded-card bg-white p-2" />
}
