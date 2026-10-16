import { describe, expect, it } from 'vitest'
import { classifyDomainErrorCode, getDomainErrorDefinition } from '../../shared/domain-errors'
import { failDomain } from '../../server/lib/response'

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
})
