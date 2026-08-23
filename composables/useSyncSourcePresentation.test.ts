import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  formatSyncSourceRelativeTime,
  getCopyrightCount,
  getActionableFailureCount,
  getIssueActionLabel,
  getIssueCount,
  getIssueSummaryLabel,
  getPlexTargetName,
  getPlexTargetHint,
  getSourceMetaLabel,
  getSourceStateLabel,
  getSourceStateTone,
  getSyncResultLabel,
  getSyncResultTone,
  getSyncSourceCoverUrl,
} from './useSyncSourcePresentation'

describe('sync source presentation helpers', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('combines derived actionable and copyright counts', () => {
    const source = {
      copyrightRestrictedCount: 2,
      actionableFailureCount: 3,
    }

    expect(getCopyrightCount(source)).toBe(2)
    expect(getActionableFailureCount(source)).toBe(3)
    expect(getIssueCount(source)).toBe(5)
  })

  it('returns zero counts when the failure read model is empty', () => {
    const source = {
      copyrightRestrictedCount: 0,
      actionableFailureCount: 0,
    }

    expect(getCopyrightCount(source)).toBe(0)
    expect(getActionableFailureCount(source)).toBe(0)
    expect(getIssueCount(source)).toBe(0)
  })

  it('formats state, result, and target labels', () => {
    expect(getSourceStateLabel({ type: 'album', enabled: true })).toBe('专辑')
    expect(getSourceStateTone({ type: 'playlist', enabled: true })).toBe('success')
    expect(getSourceStateTone({ type: 'playlist', enabled: false })).toBe('neutral')
    expect(getSyncResultLabel({ type: 'playlist', lastSyncedAt: null, lastStatus: 'success' })).toBe('未同步')
    expect(getSyncResultTone({ lastSyncedAt: '2026-06-11T11:30:00.000Z', lastStatus: 'partial' })).toBe('warning')
    expect(getPlexTargetName({ plexPlaylistName: '', neteasePlaylistName: 'Loica 2023' })).toBe('Loica 2023')
    expect(getPlexTargetHint({ plexPlaylistName: '' })).toBe('按名称匹配')
    expect(getPlexTargetHint({ plexPlaylistName: 'Loica 2023' })).toBe('指定目标')
  })

  it('builds concise metadata labels', () => {
    expect(getSourceMetaLabel({
      name: 'repeat',
      neteasePlaylistName: 'repeat',
      neteasePlaylistId: 17635087321,
    })).toBe('ID 17635087321')

    expect(getSourceMetaLabel({
      name: '告白 - Original Soundtrack',
      neteasePlaylistName: '告白 - Original Soundtrack (告白 电影原任务)',
      neteasePlaylistId: 433349401,
    })).toBe('告白 - Original Soundtrack (告白 电影原任务) · ID 433349401')

    expect(getIssueSummaryLabel({
      copyrightRestrictedCount: 1,
      actionableFailureCount: 2,
    })).toBe('待处理 2 · 版权受限 1')

    expect(getIssueActionLabel({
      copyrightRestrictedCount: 1,
      actionableFailureCount: 2,
    })).toBe('重新尝试 3 个来源异常')

    expect(getIssueSummaryLabel({
      copyrightRestrictedCount: 0,
      actionableFailureCount: 0,
    })).toBe('无待处理异常')
  })

  it('adds a single Netease image size parameter', () => {
    expect(getSyncSourceCoverUrl('')).toBe('')
    expect(getSyncSourceCoverUrl('https://img.example/cover.jpg')).toBe('https://img.example/cover.jpg?param=80y80')
    expect(getSyncSourceCoverUrl('https://img.example/cover.jpg?token=one', 160))
      .toBe('https://img.example/cover.jpg?token=one&param=160y160')
  })

  it('formats relative time against now', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-11T12:00:00.000Z'))

    expect(formatSyncSourceRelativeTime('2026-06-11T11:59:40.000Z')).toBe('刚刚')
    expect(formatSyncSourceRelativeTime('2026-06-11T11:15:00.000Z')).toBe('45分钟前')
    expect(formatSyncSourceRelativeTime('2026-06-11T09:00:00.000Z')).toBe('3小时前')
    expect(formatSyncSourceRelativeTime('2026-06-08T12:00:00.000Z')).toBe('3天前')
  })
})
