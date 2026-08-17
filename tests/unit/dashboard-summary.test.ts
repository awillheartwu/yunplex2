import { describe, expect, it } from 'vitest'
import type { ActivityEvent } from '../../server/lib/activity/types'
import type { DownloadTask } from '../../server/lib/download/queue'
import type { TaskRunSummary } from '../../server/lib/job/types'
import type { PlaylistSource } from '../../server/lib/playlist/types'
import {
  buildDashboardActivitiesFromEvents,
  buildPendingItems,
  buildRecentActivities,
  buildSourceHealthSummary,
} from '../../server/lib/dashboard/summary'

function makeSource(overrides: Partial<PlaylistSource> = {}): PlaylistSource {
  return {
    id: 'source-1',
    neteasePlaylistId: 1,
    name: 'Source',
    neteasePlaylistName: 'Source',
    type: 'playlist',
    subscribed: false,
    enabled: true,
    coverUrl: '',
    plexPlaylistName: 'Source',
    plexPlaylistRatingKey: 'plex-1',
    syncLimit: null,
    lastSyncedAt: '2026-06-10T10:00:00.000Z',
    lastStatus: 'success',
    lastError: null,
    lastJobId: null,
    autoCreatePlexPlaylist: true,
    trackCount: 10,
    lastTrackUpdateTime: null,
    forceFullCompare: false,
    downloadWhenMediaMissing: null,
    consecutiveSkips: 0,
    fullCompareAfterSkips: null,
    fullCompareAfterDays: null,
    lastFullCompareAt: null,
    plexUpdatedAt: null,
    trackIdSnapshot: null,
    lastObservedPlexFingerprint: null,
    lastAppliedPlexFingerprint: null,
    lastObservedNeteaseCursor: null,
    lastComparedNeteaseCursor: null,
    lastObservedAt: null,
    lastComparedAt: null,
    skipPlexPlaylist: false,
    skipRemoveExtraTracks: false,
    copyrightRestrictedIds: null,
    ignoredFailureIds: null,
    requiresMatchReconcile: false,
    sortOrder: 0,
    createdAt: '2026-06-10T10:00:00.000Z',
    updatedAt: '2026-06-10T10:00:00.000Z',
    ...overrides,
  }
}

function makeRun(overrides: Partial<TaskRunSummary> = {}): TaskRunSummary {
  return {
    id: 'run-1',
    type: 'sync',
    trigger: 'system',
    startedAt: '2026-06-10T10:00:00.000Z',
    finishedAt: '2026-06-10T10:05:00.000Z',
    status: 'success',
    durationMs: 300000,
    summary: '同步完成',
    source: 'source-1',
    totalSongs: 12,
    successSongs: 12,
    failedSongs: 0,
    skippedSongs: 0,
    removedSongs: 0,
    warnings: 0,
    dryRun: false,
    ...overrides,
  }
}

function makeDownload(overrides: Partial<DownloadTask> = {}): DownloadTask {
  return {
    id: 'download-1',
    sourceId: 'source-1',
    songId: 1,
    songName: 'Manta',
    artist: 'Manta',
    album: 'Album',
    status: 'done',
    progress: 100,
    quality: 'flac',
    retryCount: 0,
    createdAt: '2026-06-10T10:00:00.000Z',
    updatedAt: '2026-06-10T10:04:00.000Z',
    ...overrides,
  }
}

describe('buildSourceHealthSummary', () => {
  it('classifies success, warning, failed, and unsynced sources', () => {
    const summary = buildSourceHealthSummary([
      makeSource({ id: 'ok', lastStatus: 'success' }),
      makeSource({ id: 'warn-1', lastStatus: 'partial' }),
      makeSource({ id: 'warn-2', copyrightRestrictedIds: '["1"]' }),
      makeSource({ id: 'failed', lastStatus: 'failed' }),
      makeSource({ id: 'idle', lastStatus: 'idle', lastSyncedAt: null }),
    ])

    expect(summary).toEqual({
      total: 5,
      normal: 1,
      warning: 2,
      failed: 1,
      unsynced: 1,
    })
  })
})

describe('buildPendingItems', () => {
  it('only includes actionable pending groups and sorts them by count', () => {
    const items = buildPendingItems({
      copyrightCount: 3,
      failedDownloadCount: 2,
      failedSourceCount: 1,
    })

    expect(items.map((item) => item.id)).toEqual(['copyright', 'download-failed', 'sync-failed'])
    expect(items[0]?.count).toBe(3)
  })
})

describe('buildRecentActivities', () => {
  it('falls back to runs, downloads, and source creations when no activity events exist', () => {
    const items = buildRecentActivities({
      events: [],
      runs: [makeRun()],
      downloads: [makeDownload({ updatedAt: '2026-06-10T10:06:00.000Z' })],
      sources: [makeSource({ createdAt: '2026-06-10T10:07:00.000Z' })],
    })

    expect(items).toHaveLength(3)
    expect(items[0]?.type).toBe('source_created')
    expect(items[1]?.type).toBe('download')
    expect(items[2]?.type).toBe('sync')
  })
})

describe('buildDashboardActivitiesFromEvents', () => {
  function makeEvent(overrides: Partial<ActivityEvent>): ActivityEvent {
    return {
      id: 'event-1',
      domain: 'sync',
      type: 'source_sync_completed',
      severity: 'success',
      occurredAt: '2026-06-11T08:00:00.000Z',
      actor: 'system',
      title: '同步完成',
      summary: '同步 12 首',
      context: {},
      link: '/task-center?tab=sync-history&id=job-1',
      groupKey: 'job:job-1:source:source-1',
      ...overrides,
    }
  }

  it('prioritizes failures and user actions ahead of routine successes', () => {
    const items = buildDashboardActivitiesFromEvents([
      makeEvent({ id: 'sync-success' }),
      makeEvent({
        id: 'download-failed',
        domain: 'download',
        type: 'download_failed',
        severity: 'error',
        occurredAt: '2026-06-11T07:59:00.000Z',
        title: '下载失败：Song X',
        summary: '文件写入失败',
        groupKey: 'download:job-1:source-1',
      }),
      makeEvent({
        id: 'source-updated',
        domain: 'user',
        type: 'source_updated',
        severity: 'info',
        actor: 'user',
        occurredAt: '2026-06-11T07:58:00.000Z',
        title: '更新同步源',
        summary: '调整了同步策略',
        link: '/sync-sources',
        groupKey: 'source:source-1',
      }),
    ])

    expect(items.map((item) => item.id)).toEqual(['download-failed', 'source-updated', 'sync-success'])
  })

  it('collapses same-group events to the highest-signal winner', () => {
    const items = buildDashboardActivitiesFromEvents([
      makeEvent({
        id: 'download-ok',
        domain: 'download',
        type: 'download_completed',
        summary: 'Song A 已处理完成',
        groupKey: 'download:job-1:source-1',
      }),
      makeEvent({
        id: 'download-fail',
        domain: 'download',
        type: 'download_failed',
        severity: 'error',
        occurredAt: '2026-06-11T08:01:00.000Z',
        title: '下载失败：Song B',
        summary: '网络错误',
        groupKey: 'download:job-1:source-1',
      }),
    ])

    expect(items).toHaveLength(1)
    expect(items[0]).toEqual(expect.objectContaining({
      id: 'download-fail',
      severity: 'error',
    }))
  })
})
