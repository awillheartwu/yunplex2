import { describe, expect, it } from 'vitest'
import { presentRunSummary } from './failure-cache-presentation'

describe('historical failure presentation', () => {
  it('updates legacy run summaries at presentation time only', () => {
    expect(presentRunSummary('10 个源，失败 3 首，266 首已忽略')).toBe('10 个源，失败 3 首，266 首需关注')
    expect(presentRunSummary('用户已忽略该问题')).toBe('用户已忽略该问题')
  })
})
