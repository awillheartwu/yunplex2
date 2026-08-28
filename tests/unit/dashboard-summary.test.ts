import { describe, expect, it } from 'vitest'
import type { PlaylistSource } from '../../server/lib/playlist/types'
import { buildPendingItems, buildSourceHealthSummary } from '../../server/lib/dashboard/summary'

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
    actionableFailureCount: 0,
    copyrightRestrictedCount: 0,
    requiresMatchReconcile: false,
    syncIntervalMinutes: null,
    nextSyncAt: null,
    lastScheduleStatus: 'idle',
    lastScheduledAt: null,
    lastScheduleError: null,
    sortOrder: 0,
    createdAt: '2026-06-10T10:00:00.000Z',
    updatedAt: '2026-06-10T10:00:00.000Z',
    ...overrides,
  }
}

describe('buildSourceHealthSummary', () => {
  it('classifies success, warning, failed, and unsynced sources', () => {
    expect(buildSourceHealthSummary([
      makeSource({ id: 'ok', lastStatus: 'success' }),
      makeSource({ id: 'warn-1', lastStatus: 'partial' }),
      makeSource({ id: 'copyright-only', copyrightRestrictedCount: 1 }),
      makeSource({ id: 'failed', lastStatus: 'failed' }),
      makeSource({ id: 'idle', lastStatus: 'idle', lastSyncedAt: null }),
    ])).toEqual({ total: 5, normal: 2, warning: 1, failed: 1, unsynced: 1 })
  })
})

describe('buildPendingItems', () => {
  it('only includes actionable pending groups and sorts them by count', () => {
    const items = buildPendingItems({ copyrightCount: 3, failedDownloadCount: 2, failedSourceCount: 1 })
    expect(items.map(item => item.id)).toEqual(['copyright', 'download-failed', 'sync-failed'])
    expect(items[0]?.count).toBe(3)
  })
})
