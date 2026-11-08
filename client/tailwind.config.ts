import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

const c = (v: string) => `hsl(var(--${v}) / <alpha-value>)`;

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: { center: true, padding: '1rem', screens: { '2xl': '1240px' } },
    extend: {
      colors: {
        border: c('border'),
        input: c('input'),
        ring: c('ring'),
        background: c('background'),
        foreground: c('foreground'),
        surface: c('surface'),
        primary: { DEFAULT: c('primary'), foreground: c('primary-foreground') },
        accent: { DEFAULT: c('accent'), foreground: c('accent-foreground') },
        highlight: c('highlight'),
        muted: { DEFAULT: c('muted'), foreground: c('muted-foreground') },
        card: { DEFAULT: c('card'), foreground: c('card-foreground') },
        popover: { DEFAULT: c('popover'), foreground: c('popover-foreground') },
        destructive: { DEFAULT: c('destructive'), foreground: c('destructive-foreground') },
        success: c('success'),
        warning: c('warning'),
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'Inter', 'ui-sans-serif', 'sans-serif'],
      },
      borderRadius: { lg: 'var(--radius)', md: 'calc(var(--radius) - 4px)', sm: 'calc(var(--radius) - 6px)', xl: 'calc(var(--radius) + 4px)', '2xl': 'calc(var(--radius) + 10px)' },
      boxShadow: {
        glow: '0 0 0 1px hsl(var(--primary) / 0.25), 0 20px 60px -20px hsl(var(--primary) / 0.45)',
        soft: '0 10px 40px -12px rgb(0 0 0 / 0.35)',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--highlight)) 50%, hsl(var(--accent)) 100%)',
      },
      keyframes: {
        'caption-pop': { '0%': { transform: 'scale(0.85)', opacity: '0' }, '60%': { transform: 'scale(1.06)', opacity: '1' }, '100%': { transform: 'scale(1)' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: { 'caption-pop': 'caption-pop 0.35s ease-out', shimmer: 'shimmer 1.6s infinite' },
    },
  },
  plugins: [animate],
} satisfies Config;
