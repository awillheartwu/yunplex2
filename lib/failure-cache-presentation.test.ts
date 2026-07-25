import { describe, expect, it } from 'vitest'
import {
  countCopyrightRestrictedEntries,
  countFailureCacheEntries,
  failureCacheTotal,
  formatFailureCacheActionLabel,
  formatFailureCacheClearedLabel,
  formatFailureCacheRetryLabel,
  formatFailureCacheSummary,
  normalizeFailureCacheCounts,
  presentRunSummary,
} from './failure-cache-presentation'

describe('failure cache presentation', () => {
  it('counts only the compatible persisted shapes and tolerates corrupt storage', () => {
    expect(countFailureCacheEntries('{"song-1":{"attempts":3},"song-2":true}')).toBe(2)
    expect(countFailureCacheEntries('["song-1"]')).toBe(0)
    expect(countFailureCacheEntries('{')).toBe(0)
    expect(countCopyrightRestrictedEntries('["song-1","song-2"]')).toBe(2)
    expect(countCopyrightRestrictedEntries('{"song-1":true}')).toBe(0)
    expect(countCopyrightRestrictedEntries(null)).toBe(0)
  })

  it('uses failure-cache language without implying a user ignore action', () => {
    const counts = { continuousFailure: 2, copyrightRestricted: 1 }

    expect(formatFailureCacheSummary(counts)).toBe('失败缓存 2 · 版权受限 1')
    expect(formatFailureCacheActionLabel(counts)).toBe('当前记录：失败缓存 2 · 版权受限 1。点击清除这些记录；下次同步将重新尝试对应歌曲')
    expect(formatFailureCacheClearedLabel(counts)).toBe('已清除 3 首歌曲的失败缓存与版权受限记录')
    expect(formatFailureCacheRetryLabel(counts)).toBe('已清空 3 首歌曲的失败缓存与版权受限记录（连续失败 2，版权受限 1），增量同步已触发')
  })

  it('provides a complete accessible empty label', () => {
    const counts = { continuousFailure: 0, copyrightRestricted: 0 }
    expect(formatFailureCacheSummary(counts)).toBe('无失败缓存或版权受限')
    expect(formatFailureCacheActionLabel(counts)).toBe('无失败缓存或版权受限记录')
  })

  it('normalizes invalid counts before presenting them', () => {
    expect(normalizeFailureCacheCounts({ continuousFailure: -2, copyrightRestricted: Number.NaN })).toEqual({
      continuousFailure: 0,
      copyrightRestricted: 0,
    })
    expect(failureCacheTotal({ continuousFailure: 1.9, copyrightRestricted: 2.1 })).toBe(3)
  })

  it('updates legacy run summaries at presentation time only', () => {
    expect(presentRunSummary('10 个源，失败 3 首，266 首已忽略')).toBe('10 个源，失败 3 首，266 首需关注')
    expect(presentRunSummary('用户已忽略该问题')).toBe('用户已忽略该问题')
  })
})
