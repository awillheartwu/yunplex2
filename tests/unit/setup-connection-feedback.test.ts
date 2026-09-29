import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { classifyDomainErrorCode, getDomainErrorDefinition } from '../../shared/domain-errors'
import { failDomain } from '../../server/lib/response'

const root = resolve(__dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

describe('setup connection failure feedback', () => {
  it('keeps the exact connection-test message next to the structured error policy', () => {
    expect(failDomain('filesystem_failed', '下载目录不可写: /music')).toEqual({
      code: 1,
      msg: '下载目录不可写: /music',
      data: null,
      error: {
        code: 'filesystem_failed',
        category: 'filesystem',
        severity: 'error',
        retryable: true,
      },
    })
    expect(failDomain('netease_unavailable', '网易云网络异常').msg).toBe('网易云网络异常')
    expect(failDomain('unknown_error').msg).toBe(getDomainErrorDefinition('unknown_error').userMessage)
  })

  it('never produces the new NetEase code through runtime message classification', () => {
    expect(getDomainErrorDefinition('netease_unavailable')).toMatchObject({
      category: 'netease',
      severity: 'warning',
      retryable: true,
    })
    // The code is only attached by explicit connection-test findings, so daily runtime
    // classification keeps treating such messages the way it did before.
    expect(classifyDomainErrorCode('无法连接网易云服务')).toBe('unknown_error')
  })

  it('returns the failing step and its message when setup completion is refused', () => {
    const complete = read('server/api/setup/complete.post.ts')
    expect(complete).toContain('SETUP_CHECK_LABELS[failed.key]')
    expect(complete).toContain('failDomain(failed.code')
    expect(complete).toContain('「')

    expect(read('server/api/setup/check.post.ts')).toContain('failDomain(result.code')
    expect(read('server/api/config/test-connection.post.ts')).toContain('failDomain(error.code, error.message)')
  })

  it('bounds only the connection-test requests in the API client', () => {
    const api = read('composables/useApi.ts')
    expect(api).toContain("path === '/setup/check'")
    expect(api).toContain("path === '/setup/complete'")
    expect(api).toContain("path.startsWith('/config/test')")
    expect(api).toContain('CONNECTION_TEST_TIMEOUT_MS = 60_000')
    // Other writes keep the previous unbounded path and no request gains a retry loop.
    expect(api).toContain('return readResponse<T>(await fetch(url, fetchOptions))')
    expect(api).not.toMatch(/\b(?:for|while)\s*\(/)
  })

  it('lets the setup page fix and retry after a failed check or completion', () => {
    const page = read('pages/setup.vue')
    expect(page).toContain("checks[key] = { status: 'checking', message: '' }")
    expect(page).toContain("checks[key] = { status: result.ok ? 'ok' : 'error', message: result.message }")
    expect(page).toContain("checks[key] = { status: 'error', message: err instanceof Error ? err.message : '检查失败' }")
    expect(page).toContain("for (const key of requiredChecks) checks[key] = { status: 'idle', message: '' }")
  })
})
