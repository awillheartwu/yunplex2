import { describe, expect, it } from 'vitest'
import {
  classifyDomainErrorCode,
  getDomainErrorDefinition,
  resolveDomainErrorDefinition,
} from '../../shared/domain-errors'
import { describeDomainError, sanitizeDiagnosticMessage } from '../../server/lib/domain-error'
import { fail } from '../../server/lib/response'

describe('domain errors', () => {
  it.each([
    ['Cookie 已失效', 'authentication_failed'],
    ['HTTP 429 too many requests', 'rate_limited'],
    ['Plex connection timeout', 'plex_unavailable'],
    ['ENOSPC: no space left on device', 'filesystem_failed'],
    ['候选结果存在歧义', 'media_identity_conflict'],
    ['任务因服务重启中断', 'scheduler_interrupted'],
  ])('classifies %s as %s', (message, code) => {
    expect(classifyDomainErrorCode(message)).toBe(code)
  })

  it('keeps an explicit legacy failure code when no more specific signal exists', () => {
    expect(resolveDomainErrorDefinition('failed_plex_match', '扫描窗口结束').code).toBe('failed_plex_match')
    expect(getDomainErrorDefinition('failed_plex_match').retryable).toBe(true)
  })

  it('redacts credentials from diagnostics', () => {
    expect(sanitizeDiagnosticMessage('token=secret Cookie: abc Authorization=Bearer123'))
      .toBe('token=[REDACTED] Cookie: [REDACTED] Authorization=[REDACTED]')
  })

  it('returns structured API policy without exposing an operational diagnostic', () => {
    const response = fail(new Error('Plex timeout token=secret'), 1, 'plex_unavailable')
    expect(response).toEqual({
      code: 1,
      msg: '暂时无法连接 Plex，请检查服务状态和网络后重试。',
      data: null,
      error: {
        code: 'plex_unavailable',
        category: 'plex',
        severity: 'warning',
        retryable: true,
      },
    })
    expect(describeDomainError('Cookie=secret').diagnostic).toBe('Cookie=[REDACTED]')
  })
})
