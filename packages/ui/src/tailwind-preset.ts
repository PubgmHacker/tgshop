import type { Config } from 'tailwindcss'
import { colors, radii, fontSizes, fontWeights, spacing, gradient } from './tokens/index.js'

/**
 * Tailwind preset shared by @tgshop/miniapp, @tgshop/landing, and @tgshop/admin.
 * Consumers add this to `presets: [tgshopPreset]` in their own tailwind.config.
 * All brand values ultimately trace back to ./tokens/index.ts — edit there,
 * not here, to rebrand.
 */
export const tgshopPreset: Config = {
  darkMode: 'class',
  content: [],
  theme: {
    extend: {
      colors: {
        accent: colors.accent,
        neutral: colors.neutral,
        success: colors.success,
        warning: colors.warning,
        danger: colors.danger,
        info: colors.info
      },
      spacing,
      borderRadius: radii,
      fontSize: fontSizes,
      fontWeight: fontWeights,
      backgroundImage: {
        'brand-gradient': `linear-gradient(${gradient.angleDeg}deg, ${gradient.accent.join(', ')})`
      }
    }
  },
  plugins: []
}

export default tgshopPreset
