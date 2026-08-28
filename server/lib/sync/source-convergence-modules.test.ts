import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_CONFIG } from '../config/defaults'
import { closeDb, initDb } from '../db'
import type { NeteaseSong } from '../netease'
import { createSource, getSource } from '../playlist/store'
import type { PlaylistSource } from '../playlist/types'
import { RunBuilder } from '../run/builder'
import { applySourceDownloads } from './source-downloads'
import { finalizeSourceConvergence } from './source-finalization'
import { assertResolvedIdentitiesCurrent } from './source-plex-reconciliation'
import type { TrackResolution } from './types'

const source: PlaylistSource = {
  id: 'source-1',
  neteasePlaylistId: 42,
  name: 'Source',
  neteasePlaylistName: 'Source',
  type: 'playlist',
  subscribed: true,
  enabled: true,
  coverUrl: '',
  plexPlaylistName: 'Source',
  plexPlaylistRatingKey: 'playlist-1',
  syncLimit: null,
  lastSyncedAt: null,
  lastStatus: 'idle',
  lastError: null,
  lastJobId: null,
  autoCreatePlexPlaylist: true,
  trackCount: 0,
  lastTrackUpdateTime: null,
  forceFullCompare: null,
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
  skipPlexPlaylist: null,
  skipRemoveExtraTracks: null,
  actionableFailureCount: 0,
  copyrightRestrictedCount: 0,
  requiresMatchReconcile: false,
  syncIntervalMinutes: null,
  nextSyncAt: null,
  lastScheduleStatus: 'idle',
  lastScheduledAt: null,
  lastScheduleError: null,
  sortOrder: 0,
  createdAt: '',
  updatedAt: '',
}

function song(id: number): NeteaseSong {
  return {
    id,
    name: `Song ${id}`,
    no: id,
    dt: 180_000,
    disc: '1',
    artists: [{ name: 'Artist' }],
    album: { id: 1, name: 'Album', picUrl: '', publishTime: 0 },
  }
}

function resolution(id: number, value: TrackResolution['resolution']): TrackResolution {
  return { neteaseIndex: id - 1, song: song(id), resolution: value }
}

function addRunSong(job: RunBuilder, item: TrackResolution): string {
  return job.addSongs(source.id, [{
    songName: item.song.name,
    artist: item.song.artists[0]!.name,
    album: item.song.album.name,
    status: 'pending',
    neteaseSongId: item.song.id,
    neteaseIndex: item.neteaseIndex,
  }])[0]!
}

describe('source download convergence', () => {
  it('plans dry-run downloads without touching the queue and still requests Plex refresh', async () => {
    const job = new RunBuilder(true)
    const downloads = [resolution(1, 'needs_download'), resolution(2, 'found_on_disk')]
    downloads.forEach(item => addRunSong(job, item))
    const log = vi.fn()

    const result = await applySourceDownloads({
      source,
      resolutions: downloads,
      config: DEFAULT_CONFIG,
      job,
      stepContext: { sourceId: source.id },
      dryRun: true,
      redownloadManagedMedia: false,
      takeOverExternal: false,
      splitArtists: artists => [artists.map(item => item.name).join(' & '), artists[0]?.name ?? ''],
      throwIfCancelled: () => undefined,
      setStage: () => undefined,
      addFailure: () => undefined,
      log,
    })

    expect(result).toEqual({ needsPlexRefresh: true, downloadTargetCount: 1 })
    expect(job.getRun().steps).toMatchObject([{
      type: 'download',
      status: 'success',
      message: '[预览] 共 1 首',
    }])
    expect(log).not.toHaveBeenCalled()
  })
})

describe('source finalization projection', () => {
  it('persists a successful convergence snapshot outside dry-run mode', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reyunplex-source-finalization-'))
    initDb(dir)
    try {
      const persistedSource = await createSource(42, '', {
        type: 'album',
        name: 'Persisted Source',
      })
      const job = new RunBuilder(false)
      const completed = resolution(1, 'found_in_plex_library')
      const songId = job.addSongs(persistedSource.id, [{
        songName: completed.song.name,
        artist: completed.song.artists[0]!.name,
        album: completed.song.album.name,
        status: 'pending',
        neteaseSongId: completed.song.id,
        neteaseIndex: completed.neteaseIndex,
      }])[0]!
      job.updateSong(songId, { status: 'success', phase: 'done' })

      await finalizeSourceConvergence({
        source: persistedSource,
        job,
        dryRun: false,
        skipRemoveExtra: false,
        authoritativeTrackCount: 1,
        currentIdOrder: [1],
        trackUpdateTime: 123,
        plexUpdatedAt: null,
        plexPlaylist: null,
        log: () => undefined,
      })

      expect(getSource(persistedSource.id)).toMatchObject({
        lastStatus: 'success',
        trackCount: 1,
        lastTrackUpdateTime: 123,
        trackIdSnapshot: '[1]',
        requiresMatchReconcile: false,
      })
    } finally {
      closeDb()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('treats copyright-only exclusions as a successful source with warnings', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reyunplex-source-copyright-'))
    initDb(dir)
    try {
      const persistedSource = await createSource(43, '', {
        type: 'album',
        name: 'Copyright Source',
      })
      const job = new RunBuilder(false)
      const restricted = resolution(2, 'copyright_restricted')
      const songId = job.addSongs(persistedSource.id, [{
        songName: restricted.song.name,
        artist: restricted.song.artists[0]!.name,
        album: restricted.song.album.name,
        status: 'pending',
        neteaseSongId: restricted.song.id,
        neteaseIndex: restricted.neteaseIndex,
      }])[0]!
      job.updateSong(songId, { status: 'copyright_restricted', phase: 'download' })

      const result = await finalizeSourceConvergence({
        source: { ...persistedSource, requiresMatchReconcile: true },
        job,
        dryRun: false,
        skipRemoveExtra: false,
        authoritativeTrackCount: 1,
        currentIdOrder: [2],
        trackUpdateTime: 456,
        plexUpdatedAt: null,
        plexPlaylist: null,
      })

      expect(result).toMatchObject({ status: 'success', failedSongs: 0 })
      expect(result.summary).toContain('1 版权受限')
      expect(getSource(persistedSource.id)).toMatchObject({
        lastStatus: 'success',
        lastError: null,
        lastTrackUpdateTime: 456,
        trackIdSnapshot: '[2]',
        requiresMatchReconcile: false,
      })
    } finally {
      closeDb()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('Plex mutation identity gate', () => {
  it('aborts before mutation when a resolved ratingKey no longer matches its binding', () => {
    const resolved = resolution(1, 'found_in_plex_library')
    resolved.plexRatingKey = 'planned-rating-key'

    expect(() => assertResolvedIdentitiesCurrent(
      [resolved],
      new Map([[1, { plexRatingKey: 'current-rating-key' }]]),
    )).toThrow('身份已变化')
  })

  it('accepts unchanged identities and unresolved review targets', () => {
    const resolved = resolution(1, 'found_in_plex_library')
    resolved.plexRatingKey = 'rating-key'
    const review = resolution(2, 'needs_review')

    expect(() => assertResolvedIdentitiesCurrent(
      [resolved, review],
      new Map([[1, { plexRatingKey: 'rating-key' }]]),
    )).not.toThrow()
  })
})
