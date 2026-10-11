import { describe, expect, it } from 'vitest'
import {
  classifyDownloadFailure,
  shouldAttemptPlexRetryForResolution,
} from '~~/server/lib/sync/download-diagnostics'

describe('download diagnostics', () => {
  it('classifies tag write timeouts separately and keeps Plex retry open when file exists', () => {
    const diagnosis = classifyDownloadFailure(
      '标签写入失败: 温室 — FLAC 标签写入 超时（>120s）',
      '/music/温室.flac',
    )

    expect(diagnosis).toMatchObject({
      status: 'failed_tags',
      phase: 'tags',
      shouldRecordFailure: true,
      shouldAttemptPlexRetry: true,
      errorCode: 'failed_tags',
      retryable: true,
    })
    expect(shouldAttemptPlexRetryForResolution('needs_download', 'failed_tags', '/music/温室.flac')).toBe(true)
  })

  it('classifies copyright failures and skips Plex retry', () => {
    const diagnosis = classifyDownloadFailure('无法获取歌曲下载链接')

    expect(diagnosis).toMatchObject({
      status: 'copyright_restricted',
      phase: 'download',
      shouldRecordFailure: false,
      shouldAttemptPlexRetry: false,
      errorCode: 'copyright_restricted',
      retryable: false,
    })
    expect(shouldAttemptPlexRetryForResolution('needs_download', 'copyright_restricted')).toBe(false)
  })
})
