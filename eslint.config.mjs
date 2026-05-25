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
        useRuntimeConfig: 'readonly',
        useRoute: 'readonly',
        useRouter: 'readonly',
        defineEventHandler: 'readonly',
        getQuery: 'readonly',
        getRouterParam: 'readonly',
        readBody: 'readonly',
        defineNuxtConfig: 'readonly',
        defineNitroPlugin: 'readonly',
        useApi: 'readonly',
        useSync: 'readonly',
        useJobs: 'readonly',
        useTheme: 'readonly',
      },
    },
    rules: {
      'vue/multi-word-component-names': 'off',
      'vue/return-in-computed-property': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
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
  prettierConfig,
  { ignores: ['.nuxt/**', '.output/**', 'dist/**', 'node_modules/**'] },
)
