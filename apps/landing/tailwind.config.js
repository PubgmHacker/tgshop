/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: '#05070d',
          soft: '#0a0e1a',
          card: '#0f1420',
        },
        accent: {
          from: '#7c5cff',
          via: '#6a8cff',
          to: '#38d9c9',
          DEFAULT: '#7c5cff',
        },
        line: '#1c2230',
        muted: '#8b93a7',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        'accent-gradient': 'linear-gradient(135deg, #7c5cff 0%, #6a8cff 50%, #38d9c9 100%)',
        'radial-fade': 'radial-gradient(ellipse at top, rgba(124,92,255,0.25), transparent 60%)',
      },
      animation: {
        'gradient-x': 'gradient-x 8s ease infinite',
        float: 'float 6s ease-in-out infinite',
        marquee: 'marquee 30s linear infinite',
      },
      keyframes: {
        'gradient-x': {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        marquee: {
          '0%': { transform: 'translateX(0%)' },
          '100%': { transform: 'translateX(-50%)' },
        },
      },
      boxShadow: {
        glow: '0 0 40px rgba(124,92,255,0.25)',
      },
    },
  },
  plugins: [],
};
