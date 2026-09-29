import js from '@eslint/js'
import ts from 'typescript-eslint'
import vue from 'eslint-plugin-vue'
import prettierConfig from 'eslint-config-prettier'
import globals from 'globals'

export default ts.config(
  js.configs.recommended,
  ...ts.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        // Nuxt auto-imports
        ref: 'readonly',
        computed: 'readonly',
        reactive: 'readonly',
        watch: 'readonly',
        onMounted: 'readonly',
        onUnmounted: 'readonly',
        useFetch: 'readonly',
        useState: 'readonly',
        useRuntimeConfig: 'readonly',
        useRoute: 'readonly',
        useRouter: 'readonly',
        definePageMeta: 'readonly',
        defineNuxtRouteMiddleware: 'readonly',
        defineEventHandler: 'readonly',
        getQuery: 'readonly',
        getRouterParam: 'readonly',
        readBody: 'readonly',
        setCookie: 'readonly',
        deleteCookie: 'readonly',
        setResponseStatus: 'readonly',
        defineNuxtConfig: 'readonly',
        defineNitroPlugin: 'readonly',
        useApi: 'readonly',
        useSync: 'readonly',
        useSyncStatus: 'readonly',
        useSourceSync: 'readonly',
        useManualDownload: 'readonly',
        useFailures: 'readonly',
        useTheme: 'readonly',
        useAuth: 'readonly',
        navigateTo: 'readonly',
        nextTick: 'readonly',
        sseSubscribe: 'readonly',
        sseConnected: 'readonly',
      },
    },
    rules: {
      'vue/multi-word-component-names': 'off',
      'vue/return-in-computed-property': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: '@typescript-eslint/parser' },
    },
  },
  {
    // Test doubles sometimes need to stand in for large third-party objects.
    // Production code remains protected by the error-level rule above.
    files: ['**/*.test.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  prettierConfig,
  { ignores: ['.nuxt/**', '.output/**', 'dist/**', 'node_modules/**'] },
)
