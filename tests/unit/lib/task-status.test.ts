import { describe, expect, it } from 'vitest'
import {
  SONG_STATUS_BUCKETS,
  isFailedSongStatus,
  isAttentionSongStatus,
  isIgnoredSongStatus,
  runResultItems,
  songMatchesStatusBucket,
  songStatusBucketCount,
  songStatusPresentation,
} from '~~/lib/task-status'

describe('task status semantics', () => {
  it('uses the agreed semantic palette categories', () => {
    expect(songStatusPresentation('success').tone).toBe('success')
    expect(songStatusPresentation('skipped_existing').tone).toBe('existing')
    expect(songStatusPresentation('copyright_restricted').tone).toBe('ignored')
    expect(songStatusPresentation('failed_plex_match').tone).toBe('warning')
    expect(songStatusPresentation('failed_download').tone).toBe('failure')
    expect(songStatusPresentation('downloading').tone).toBe('running')
  })

  it('classifies attention and failed states without overlap', () => {
    expect(isAttentionSongStatus('ignored_failure')).toBe(true)
    expect(isAttentionSongStatus('copyright_restricted')).toBe(true)
    expect(isAttentionSongStatus('awaiting_manual_match')).toBe(true)
    expect(isIgnoredSongStatus('ignored_failure')).toBe(true)
    expect(isIgnoredSongStatus('copyright_restricted')).toBe(true)
    expect(isFailedSongStatus('failed_download')).toBe(true)
    expect(isFailedSongStatus('failed_tags')).toBe(true)
    expect(isFailedSongStatus('copyright_restricted')).toBe(false)
  })

  it('groups song statuses into the same buckets used by run detail filters', () => {
    expect(songMatchesStatusBucket('success', 'success')).toBe(true)
    expect(songMatchesStatusBucket('failed_tags', 'failure')).toBe(true)
    expect(songMatchesStatusBucket('failed_plex_match', 'failure')).toBe(true)
    expect(songMatchesStatusBucket('skipped_existing', 'existing')).toBe(true)
    expect(songMatchesStatusBucket('removed', 'removed')).toBe(true)
    expect(songMatchesStatusBucket('copyright_restricted', 'restricted')).toBe(true)
    expect(songMatchesStatusBucket('ignored_failure', 'ignored')).toBe(true)
    expect(songMatchesStatusBucket('awaiting_manual_match', 'manual')).toBe(true)
    expect(songMatchesStatusBucket('copyright_restricted', 'ignored')).toBe(false)
    expect(songMatchesStatusBucket('awaiting_manual_match', 'ignored')).toBe(false)
    expect(songMatchesStatusBucket('copyright_restricted', 'failure')).toBe(false)
  })

  it('labels manually ignored failures explicitly', () => {
    expect(songStatusPresentation('ignored_failure').label).toBe('已忽略')
    expect(SONG_STATUS_BUCKETS.find(bucket => bucket.key === 'ignored')?.label).toBe('已忽略')
  })

  it('counts bucket totals for song filter badges', () => {
    expect(songStatusBucketCount([
      { status: 'success' },
      { status: 'skipped_existing' },
      { status: 'failed_download' },
      { status: 'failed_plex_insert' },
      { status: 'ignored_failure' },
    ], 'failure')).toBe(2)
  })

  it('builds result items in a consistent scanning order', () => {
    expect(runResultItems({
      successSongs: 1,
      skippedSongs: 42,
      warnings: 1,
      removedSongs: 1,
      failedSongs: 0,
    }).map(item => [item.label, item.count, item.tone])).toEqual([
      ['成功', 1, 'success'],
      ['已存在', 42, 'existing'],
      ['历史提示', 1, 'warning'],
      ['已移除', 1, 'warning'],
      ['失败', 0, 'failure'],
    ])
  })
})
