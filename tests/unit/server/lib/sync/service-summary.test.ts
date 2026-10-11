import { describe, expect, it } from 'vitest'
import type { SyncJob } from '~~/server/lib/job/types'
import { buildSyncRunSummary } from '~~/server/lib/sync/service-summary'

function job(overrides: Partial<SyncJob> = {}): SyncJob {
  return {
    successSongs: 1,
    failedSongs: 0,
    warnings: 0,
    totalSongs: 1,
    ...overrides,
  } as SyncJob
}

describe('sync service summary copy', () => {
  it('describes warnings as attention items rather than user ignores', () => {
    expect(buildSyncRunSummary({
      job: job({ successSongs: 1, failedSongs: 2, warnings: 3 }),
      sourceCount: 4,
      mode: 'normal',
    })).toBe('4 个源，新增 1 首，失败 2 首，3 首需关注')
  })

  it('separates already-present tracks from newly inserted tracks', () => {
    expect(buildSyncRunSummary({
      job: job({ successSongs: 0, skippedSongs: 15, failedSongs: 3, warnings: 18 }),
      sourceCount: 1,
      mode: 'normal',
    })).toBe('1 个源，已存在 15 首，失败 3 首，18 首需关注')
  })

  it('reports a true no-op without pretending every target was inserted', () => {
    expect(buildSyncRunSummary({
      job: job({ successSongs: 0, skippedSongs: 0, totalSongs: 0 }),
      sourceCount: 1,
      mode: 'normal',
    })).toBe('1 个源，无需变更（目标 0 首）')
  })

  it('labels an explicit audio redownload run distinctly', () => {
    expect(buildSyncRunSummary({
      job: job({ successSongs: 2, skippedSongs: 1 }),
      sourceCount: 1,
      mode: 'redownload_managed',
    })).toBe('重新下载托管音频并同步：1 个源，重新下载 2 首，保护或保留 1 首')
  })
})
