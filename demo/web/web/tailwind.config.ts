import type { Config } from 'tailwindcss';

/**
 * Same token contract as the admin portal and the mobile app
 * (frontend/src/theme/colors.ts). Values are CSS variables so light/dark is a
 * class swap on <html> and nothing else has to know about it.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: 'rgb(var(--bg-primary) / <alpha-value>)',
          subtle: 'rgb(var(--bg-secondary) / <alpha-value>)',
          card: 'rgb(var(--bg-card) / <alpha-value>)',
          elevated: 'rgb(var(--bg-elevated) / <alpha-value>)',
        },
        text: {
          primary: 'rgb(var(--text-primary) / <alpha-value>)',
          secondary: 'rgb(var(--text-secondary) / <alpha-value>)',
          muted: 'rgb(var(--text-muted) / <alpha-value>)',
        },
        brand: {
          primary: 'rgb(var(--brand-primary) / <alpha-value>)',
          accent: 'rgb(var(--brand-accent) / <alpha-value>)',
        },
        border: {
          DEFAULT: 'rgb(var(--border) / <alpha-value>)',
          strong: 'rgb(var(--border-strong) / <alpha-value>)',
        },
        chat: {
          outgoing: 'rgb(var(--chat-outgoing) / <alpha-value>)',
          incoming: 'rgb(var(--chat-incoming) / <alpha-value>)',
          composer: 'rgb(var(--chat-composer) / <alpha-value>)',
        },
        success: 'rgb(var(--success) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        info: 'rgb(var(--info) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgb(9 12 24 / 0.04), 0 6px 16px -6px rgb(9 12 24 / 0.08)',
        elevated: '0 2px 4px rgb(9 12 24 / 0.04), 0 12px 32px -8px rgb(9 12 24 / 0.14)',
        whisper: '0 1px 1px rgb(9 12 24 / 0.03), 0 2px 6px -2px rgb(9 12 24 / 0.06)',
      },
      borderRadius: {
        // Intentional scale rather than one radius everywhere.
        bubble: '1.25rem',
        control: '0.625rem',
      },
      transitionTimingFunction: {
        'out-quart': 'cubic-bezier(0.25, 1, 0.5, 1)',
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
};

export default config;
