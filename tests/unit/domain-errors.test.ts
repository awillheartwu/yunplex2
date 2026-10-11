import { describe, expect, it } from 'vitest'
import {
  classifyDomainErrorCode,
  getDomainErrorDefinition,
  resolveDomainErrorDefinition,
} from '../../shared/domain-errors'
import { describeDomainError, sanitizeDiagnosticMessage } from '../../server/lib/domain-error'
import { fail, failDomain } from '../../server/lib/response'

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

  it.each([
    ['Plex timeout Authorization: Bearer fixture-bearer', ['fixture-bearer']],
    ['Plex timeout Authorization: Basic fixture-basic', ['fixture-basic']],
    ['Plex timeout Cookie: MUSIC_U=fixture-music; __csrf=fixture-csrf; session=fixture-session', ['fixture-music', 'fixture-csrf', 'fixture-session']],
    ['Plex timeout {"token":"fixture token with spaces","password":"fixture-password","cookie":"MUSIC_U=fixture-music; __csrf=fixture-csrf"}', ['fixture token with spaces', 'fixture-password', 'fixture-music', 'fixture-csrf']],
    ['Plex timeout http://fixture-user:fixture-password@plex.example/identity?X-Plex-Token=fixture-plex&api_key=fixture-api', ['fixture-user', 'fixture-password', 'fixture-plex', 'fixture-api']],
    ['Plex timeout MUSIC_U=fixture-music; __csrf=fixture-csrf; access_token=fixture-access', ['fixture-music', 'fixture-csrf', 'fixture-access']],
  ])('redacts complete credentials in %s', (message, secrets) => {
    const diagnostic = sanitizeDiagnosticMessage(message)!
    expect(diagnostic).toContain('Plex timeout')
    for (const secret of secrets) expect(diagnostic).not.toContain(secret)
    expect(sanitizeDiagnosticMessage(diagnostic)).toBe(diagnostic)
  })

  it('redacts validation and explicit domain responses while retaining useful context', () => {
    const message = '配置不合法: password=fixture-password token=fixture-token'
    for (const response of [fail(message, 1, 'validation_failed'), failDomain('validation_failed', message)]) {
      expect(response.msg).toContain('配置不合法')
      expect(response.msg).not.toContain('fixture-password')
      expect(response.msg).not.toContain('fixture-token')
      expect(response.error?.code).toBe('validation_failed')
    }
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
