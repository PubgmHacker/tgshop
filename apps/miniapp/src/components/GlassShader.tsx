'use client'

import { useEffect } from 'react'

// Specular sweep lives in CSS (@keyframes sheen-sweep). Driving --spec on
// every animation frame fought that animation and made the banner hitch.
export function GlassShader(): null {
  useEffect(() => {
    document.documentElement.style.setProperty('--spec', '0.2')
  }, [])

  return null
}
