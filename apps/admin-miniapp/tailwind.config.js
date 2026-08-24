/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        app: 'var(--bg)',
        'app-soft': 'var(--bg-soft)',
        card: 'var(--card)',
        'card-strong': 'var(--card-strong)',
        line: 'var(--line)',
        'line-strong': 'var(--line-strong)',
        ink: 'var(--ink)',
        muted: 'var(--muted)',
        faint: 'var(--faint)',
        cta: 'var(--cta)',
        'cta-ink': 'var(--cta-ink)',
        mark: 'var(--mark)',
        danger: 'var(--danger)',
        success: 'var(--success)',
        warning: 'var(--warning)',
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
        card: '16px',
        tile: '18px',
        sheet: '22px'
      },
      boxShadow: {
        card: '0 1px 0 rgba(255,255,255,0.04) inset, 0 18px 40px -24px rgba(0,0,0,0.7)',
        nav: '0 10px 40px -12px rgba(0,0,0,0.65)'
      }
    }
  },
  plugins: []
}
