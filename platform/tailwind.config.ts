import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--ii-bg)',
        surface: 'var(--ii-surface)',
        ink: {
          DEFAULT: 'var(--ii-ink)',
          900: 'var(--ii-ink)',
          800: '#222222',
          700: '#333333',
          600: 'var(--ii-muted)',
          500: '#888888',
          400: 'var(--ii-faint)',
          300: '#cccccc',
          200: '#e5e5e5',
          100: '#f5f5f5',
        },
        border: {
          DEFAULT: 'var(--ii-border)',
          soft: 'var(--ii-border-soft)',
        },
        accent: 'var(--ii-accent)',
        gold: 'var(--ii-gold)',
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          '"Segoe UI"',
          'Roboto',
          'sans-serif',
        ],
      },
      fontSize: {
        xs: ['11px', { lineHeight: '16px', letterSpacing: '0.02em' }],
        sm: ['13px', { lineHeight: '18px', letterSpacing: '-0.01em' }],
        base: ['15px', { lineHeight: '22px', letterSpacing: '-0.01em' }],
        lg: ['18px', { lineHeight: '26px', letterSpacing: '-0.02em' }],
        xl: ['22px', { lineHeight: '28px', letterSpacing: '-0.02em' }],
        '2xl': ['28px', { lineHeight: '34px', letterSpacing: '-0.03em' }],
        '3xl': ['36px', { lineHeight: '42px', letterSpacing: '-0.03em' }],
        '4xl': ['44px', { lineHeight: '50px', letterSpacing: '-0.03em' }],
      },
      borderRadius: {
        DEFAULT: '6px',
        md: '6px',
        lg: '8px',
        xl: '10px',
      },
      boxShadow: {
        soft: '0 1px 3px 0 rgba(0,0,0,0.04)',
        card: '0 1px 2px 0 rgba(0,0,0,0.03)',
        hover: '0 2px 8px 0 rgba(0,0,0,0.06)',
      },
    },
  },
  plugins: [],
};
export default config;
