/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        tg: {
          bg: 'var(--tg-bg-color)',
          text: 'var(--tg-text-color)',
          hint: 'var(--tg-hint-color)',
          link: 'var(--tg-link-color)',
          button: 'var(--tg-button-color)',
          'button-text': 'var(--tg-button-text-color)',
          'secondary-bg': 'var(--tg-secondary-bg-color)',
          'header-bg': 'var(--tg-header-bg-color)',
          'accent-text': 'var(--tg-accent-text-color)',
          'section-bg': 'var(--tg-section-bg-color)',
          'section-header-text': 'var(--tg-section-header-text-color)',
          subtitle: 'var(--tg-subtitle-text-color)',
          destructive: 'var(--tg-destructive-text-color)'
        }
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, var(--accent-from), var(--accent-to))'
      },
      borderRadius: {
        card: '14px',
        sheet: '20px'
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.06), 0 1px 8px rgba(0,0,0,0.04)'
      }
    }
  },
  plugins: []
}
