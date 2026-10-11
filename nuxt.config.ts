export default defineNuxtConfig({
  ssr: false,

  routeRules: {
    '/**': { ssr: false },
  },

  devServer: {
    host: 'localhost',
    port: 3001,
  },

  vite: {
    build: {
      chunkSizeWarningLimit: 600,
    },
    optimizeDeps: {
      include: ['@lucide/vue'],
    },
    server: {
      watch: {
        ignored: ['**/node_modules/**', '**/data/**', '**/tests/**'],
      },
    },
  },

  modules: ['@nuxtjs/tailwindcss'],

  components: [
    {
      path: '~/components',
      pathPrefix: false,
    },
  ],

  telemetry: false,
  devtools: { enabled: true },

  runtimeConfig: {
    dataDir: './data',
  },

  app: {
    head: {
      script: [{ innerHTML: `(${initializeAppearance.toString()})();`, tagPosition: 'head' }],
      title: 'reYunPlex',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      ],
    },
  },

  css: [
    '~/assets/css/fonts.css',
    '~/assets/css/tokens.css',
    '~/assets/css/main.css',
    '~/assets/css/global/controls.css',
    '~/assets/css/global/components.css',
  ],

  tailwindcss: {
    cssPath: '~/assets/css/main.css',
    config: {
      darkMode: 'class',
      content: [],
      theme: {
        extend: {
          colors: {
            surface: {
              DEFAULT: 'var(--bg-surface)',
              elevated: 'var(--bg-elevated)',
              overlay: 'var(--bg-overlay)',
            },
            muted: {
              DEFAULT: 'var(--text-secondary)',
              deep: 'var(--text-tertiary)',
            },
            accent: {
              DEFAULT: 'var(--accent)',
              hover: 'var(--accent-strong)',
              muted: 'var(--accent-muted)',
            },
            success: 'var(--success)',
            warning: 'var(--warning)',
            danger: 'var(--danger)',
          },
          fontFamily: {
            sans: ['var(--font-ui)'],
            mono: ['var(--font-mono)'],
          },
          fontSize: {
            '2xs': ['var(--text-xs)', { lineHeight: 'var(--body-leading)' }],
            xs: ['var(--text-xs)', { lineHeight: 'var(--body-leading)' }],
            sm: ['var(--text-sm)', { lineHeight: 'var(--body-leading)' }],
            base: ['var(--text-base)', { lineHeight: 'var(--body-leading)' }],
            md: ['var(--text-md)', { lineHeight: 'var(--body-leading)' }],
            lg: ['var(--text-lg)', { lineHeight: 'var(--heading-leading)' }],
            xl: ['var(--text-xl)', { lineHeight: 'var(--heading-leading)' }],
            '2xl': ['var(--text-2xl)', { lineHeight: 'var(--heading-leading)' }],
            '3xl': ['var(--text-3xl)', { lineHeight: 'var(--heading-leading)' }],
            '4xl': ['var(--text-4xl)', { lineHeight: 'var(--heading-leading)' }],
          },
          fontWeight: {
            normal: 'var(--font-weight-normal)',
            medium: 'var(--font-weight-medium)',
            semibold: 'var(--font-weight-semibold)',
            bold: 'var(--font-weight-bold)',
            extrabold: 'var(--font-weight-bold)',
          },
          borderRadius: {
            DEFAULT: 'var(--radius-sm)',
            sm: 'var(--radius-xs)',
            md: 'var(--radius-md)',
            lg: 'var(--radius-lg)',
            xl: 'var(--radius-xl)',
            '2xl': 'var(--radius-2xl)',
            full: 'var(--radius-full)',
          },
          spacing: Object.fromEntries(
            [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 20, 24]
              .map(step => [String(step), `var(--space-${String(step).replace('.', '_')})`]),
          ),
          boxShadow: {
            DEFAULT: 'var(--shadow-sm)',
            sm: 'var(--shadow-sm)',
            md: 'var(--shadow-md)',
            lg: 'var(--shadow-lg)',
            xl: 'var(--shadow-lg)',
            '2xl': 'var(--shadow-lg)',
            inner: 'var(--shadow-inset)',
          },
          lineHeight: {
            tight: 'var(--heading-leading)',
            normal: 'var(--body-leading)',
            relaxed: 'var(--leading-relaxed)',
          },
          transitionDuration: {
            DEFAULT: 'var(--duration-fast)',
            150: 'var(--duration-fast)',
            200: 'var(--duration-normal)',
            300: 'var(--duration-slow)',
          },
        },
      },
    },
  },

  nitro: {
    plugins: ['~/server/plugins/sync-daemon'],
  },

  compatibilityDate: '2025-01-01',
})
import { initializeAppearance } from './lib/appearance'
