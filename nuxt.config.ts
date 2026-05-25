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
    server: {
      watch: {
        ignored: ['**/node_modules/**', '**/data/**', '**/test/**', '**/../yunplex/**', '**/../yunPlexBackend/**', '**/../yunPlexFrontend/**'],
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
      title: 'YunPlex2',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
        },
      ],
    },
  },

  css: ['~/assets/css/main.css'],

  tailwindcss: {
    config: {
      darkMode: 'class',
      content: [],
      theme: {
        extend: {
          colors: {
            surface: {
              DEFAULT: 'var(--bg-surface)',
              elevated: 'var(--bg-elevated)',
              overlay: 'var(--border-secondary)',
            },
            muted: {
              DEFAULT: 'var(--text-secondary)',
              deep: 'var(--text-tertiary)',
            },
            accent: {
              DEFAULT: '#5e6ad2',
              hover: '#6c77e0',
              muted: 'rgba(94, 106, 210, 0.12)',
            },
            success: '#2ecc71',
            warning: '#f1c40f',
            danger: '#e74c3c',
          },
          fontFamily: {
            sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
            mono: ['SF Mono', 'Fira Code', 'monospace'],
          },
          fontSize: {
            '2xs': ['0.75rem', { lineHeight: '1.125rem' }],
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
