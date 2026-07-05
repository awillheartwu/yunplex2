import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')

describe('frontend auth integration', () => {
  it('routes setup and login states from the global auth middleware', () => {
    const source = readFileSync(resolve(root, 'middleware/auth.global.ts'), 'utf-8')

    expect(source).toContain("state.setupRequired")
    expect(source).toContain("navigateTo('/setup')")
    expect(source).toContain("path: '/login'")
    expect(source).toContain("query: { redirect: to.fullPath }")
  })

  it('adds csrf headers to mutating API calls and handles auth status codes', () => {
    const source = readFileSync(resolve(root, 'composables/useApi.ts'), 'utf-8')

    expect(source).toContain("'X-CSRF-Token'")
    expect(source).toContain('res.status === 401')
    expect(source).toContain('res.status === 428')
    expect(source).toContain("navigateTo('/setup')")
  })
})
