import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readConfigFromDb, getDb, writeConfigToDb } from '~~/server/lib/db'
import type { NeteaseSong, RawSong } from '~~/server/lib/netease'
import { saveNeteaseRawSongs } from '~~/server/lib/netease-song-cache'
import type { PlexTrack } from '~~/server/lib/plex-client'
import { getSource, updateSource } from '~~/server/lib/playlist/store'
import { getRun } from '~~/server/lib/run/store'
import { upsertSongIdentityBinding } from '~~/server/lib/sync/identity-store'
import { getSyncService } from '~~/server/lib/sync/service'
import type { SyncMode } from '~~/server/lib/sync/service-state'
import { getFailureRecords } from '~~/server/lib/tasks/failure-queries'
import { recordFailure, setFailureRecordStatus } from '~~/server/lib/tasks/failure-records'
import {
  createFailureTestDatabase,
  insertFailureSource,
} from '../../../../helpers/failure-fixtures'

const remote = vi.hoisted(() => ({
  checkCookie: vi.fn(),
  fetchPlaylistSummary: vi.fn(),
  fetchNeteaseSongDetails: vi.fn(),
  initPlexClient: vi.fn(),
  getPlaylistSnapshotByRatingKey: vi.fn(),
  getPlaylistByRatingKey: vi.fn(),
  findPlaylist: vi.fn(),
  getPlaylistTracks: vi.fn(),
  getPlaylistUpdatedAt: vi.fn(),
  getSectionKey: vi.fn(),
  getTracksByRatingKeys: vi.fn(),
  getTrackByRatingKey: vi.fn(),
  findTracksByFilePath: vi.fn(),
  getRecentlyAddedTracks: vi.fn(),
  getLibraryScanState: vi.fn(),
  insertTrackIntoPlaylist: vi.fn(),
  insertTracksIntoPlaylist: vi.fn(),
  getPlaylistItemIds: vi.fn(),
  movePlaylistItemToTop: vi.fn(),
  movePlaylistItemAfter: vi.fn(),
  removeTrackFromPlaylist: vi.fn(),
}))

vi.mock('~~/server/lib/netease', async importOriginal => {
  const actual = await importOriginal<typeof import('~~/server/lib/netease')>()
  return {
    ...actual,
    checkCookie: remote.checkCookie,
    fetchPlaylistSummary: remote.fetchPlaylistSummary,
    fetchNeteaseSongDetails: remote.fetchNeteaseSongDetails,
    clearAlbumCache: () => undefined,
    setArtistAliases: () => undefined,
  }
})

vi.mock('~~/server/lib/plex-client', async importOriginal => {
  const actual = await importOriginal<typeof import('~~/server/lib/plex-client')>()
  return {
    ...actual,
    initPlexClient: remote.initPlexClient,
    getPlaylistSnapshotByRatingKey: remote.getPlaylistSnapshotByRatingKey,
    getPlaylistByRatingKey: remote.getPlaylistByRatingKey,
    findPlaylist: remote.findPlaylist,
    getPlaylistTracks: remote.getPlaylistTracks,
    getPlaylistWriteTracks: remote.getPlaylistTracks,
    assertPlexClientConfig: vi.fn(),
    getPlaylistUpdatedAt: remote.getPlaylistUpdatedAt,
    getSectionKey: remote.getSectionKey,
    getTracksByRatingKeys: remote.getTracksByRatingKeys,
    getTrackByRatingKey: remote.getTrackByRatingKey,
    findTracksByFilePath: remote.findTracksByFilePath,
    getRecentlyAddedTracks: remote.getRecentlyAddedTracks,
    getLibraryScanState: remote.getLibraryScanState,
    insertTrackIntoPlaylist: remote.insertTrackIntoPlaylist,
    insertTracksIntoPlaylist: remote.insertTracksIntoPlaylist,
    getPlaylistItemIds: remote.getPlaylistItemIds,
    movePlaylistItemToTop: remote.movePlaylistItemToTop,
    movePlaylistItemAfter: remote.movePlaylistItemAfter,
    removeTrackFromPlaylist: remote.removeTrackFromPlaylist,
  }
})

const ignoredSongId = 101
const activeSongId = 202
const ignoredRatingKey = 'plex-ignored'
const activeRatingKey = 'plex-active'

const activeSong: NeteaseSong = {
  id: activeSongId,
  name: 'Active Song',
  no: 1,
  dt: 180_000,
  disc: '1',
  artists: [{ name: 'Fixture Artist' }],
  album: { id: 1, name: 'Fixture Album', picUrl: '', publishTime: 1_700_000_000_000 },
}

const ignoredRawSong: RawSong = {
  id: ignoredSongId,
  name: 'Ignored Song',
  no: 2,
  dt: 200_000,
  cd: '1',
  publishTime: 1_700_000_000_000,
  ar: [{ id: 1, name: 'Fixture Artist' }],
  al: {
    id: 1,
    name: 'Fixture Album',
    picUrl: '',
    publishTime: 1_700_000_000_000,
  },
}

function plexTrack(
  ratingKey: string,
  playlistItemID: number,
  title: string,
  file: string,
): PlexTrack {
  return {
    ratingKey,
    playlistItemID,
    title,
    grandparentTitle: 'Fixture Artist',
    parentTitle: 'Fixture Album',
    Media: [{ Part: [{ file }] }],
  }
}

async function runIgnoredSync(
  mode: SyncMode,
  options: { withIgnoredDetails?: boolean } = {},
) {
  const testDb = createFailureTestDatabase(`reyunplex-ignored-${mode}-`, 3)
  try {
    writeFileSync(join(testDb.directory, 'Ignored Song.flac'), 'fLaCfixture')
    writeFileSync(join(testDb.directory, 'Active Song.flac'), 'fLaCfixture')
    insertFailureSource('source-1')
    updateSource('source-1', {
      name: 'Ignored Source',
      neteasePlaylistName: 'Ignored Source',
      plexPlaylistName: 'Ignored Source',
      plexPlaylistRatingKey: 'playlist-1',
      autoCreatePlexPlaylist: false,
      skipRemoveExtraTracks: false,
    })
    if (options.withIgnoredDetails) saveNeteaseRawSongs([ignoredRawSong])

    for (let round = 1; round <= 3; round += 1) {
      recordFailure({
        songId: ignoredSongId,
        songName: 'Ignored Song',
        artist: 'Fixture Artist',
        sourceId: 'source-1',
        runId: `ignored-failure-${round}`,
        runType: 'sync',
        failureKind: 'failed_download',
        failureReason: 'controlled NetEase failure',
        occurredAt: `2026-10-18T00:0${round}:00.000Z`,
      })
    }
    const ignoredFailure = getDb().prepare(`
      SELECT id FROM failure_records WHERE source_id = 'source-1' AND song_id = ?
    `).get(ignoredSongId) as { id: string }
    setFailureRecordStatus([ignoredFailure.id], 'ignored')
    const cachedIgnoredPublishTime = options.withIgnoredDetails
      ? (JSON.parse((getDb().prepare(`
          SELECT raw_json FROM netease_song_details WHERE netease_song_id = ?
        `).get(ignoredSongId) as { raw_json: string }).raw_json) as RawSong).publishTime ?? null
      : null

    const ignoredTrack = plexTrack(
      ignoredRatingKey,
      10,
      'Ignored Song',
      '/music/Ignored Song.flac',
    )
    const activeTrack = plexTrack(
      activeRatingKey,
      11,
      activeSong.name,
      '/music/Active Song.flac',
    )
    const playlistTracks = [ignoredTrack, activeTrack]
    upsertSongIdentityBinding({
      neteaseSongId: ignoredSongId,
      plexSectionKey: 'section-1',
      plexSectionRoot: '/music',
      plexFilePath: '/music/Ignored Song.flac',
      plexRatingKey: ignoredRatingKey,
      bindingMethod: 'manual',
      status: 'active',
      evidence: { fixture: 'ignored item remains in Plex' },
    })
    upsertSongIdentityBinding({
      neteaseSongId: activeSongId,
      plexSectionKey: 'section-1',
      plexSectionRoot: '/music',
      plexFilePath: '/music/Active Song.flac',
      plexRatingKey: activeRatingKey,
      bindingMethod: 'manual',
      status: 'active',
      evidence: { fixture: 'active target' },
    })

    remote.checkCookie.mockResolvedValue({ valid: true })
    remote.fetchPlaylistSummary.mockResolvedValue({
      trackIds: [{ id: ignoredSongId }, { id: activeSongId }],
      allTrackIds: [{ id: ignoredSongId }, { id: activeSongId }],
      trackUpdateTime: 10,
      playlistName: 'Ignored Source',
      playlist: null,
    })
    remote.fetchNeteaseSongDetails.mockResolvedValue({ songs: [activeSong], rawSongs: [] })
    remote.initPlexClient.mockResolvedValue('machine-1')
    remote.getPlaylistByRatingKey.mockResolvedValue({ title: 'Ignored Source', ratingKey: 'playlist-1', playlistType: 'audio', smart: 0 })
    remote.findPlaylist.mockResolvedValue({ title: 'Ignored Source', ratingKey: 'playlist-1', playlistType: 'audio', smart: 0 })
    remote.getPlaylistSnapshotByRatingKey.mockResolvedValue({
      playlist: { title: 'Ignored Source', ratingKey: 'playlist-1', playlistType: 'audio', smart: 0 },
      updatedAt: 10,
      tracks: playlistTracks,
    })
    remote.getPlaylistTracks.mockResolvedValue(playlistTracks)
    remote.getPlaylistUpdatedAt.mockResolvedValue(10)
    remote.getSectionKey.mockResolvedValue('section-1')
    remote.getTracksByRatingKeys.mockImplementation(async (keys: string[]) => new Map(
      playlistTracks.filter(track => keys.includes(track.ratingKey)).map(track => [track.ratingKey, track]),
    ))
    remote.getTrackByRatingKey.mockImplementation(async (key: string) =>
      playlistTracks.find(track => track.ratingKey === key) ?? null,
    )
    remote.findTracksByFilePath.mockResolvedValue([])
    remote.getRecentlyAddedTracks.mockResolvedValue([])
    remote.getLibraryScanState.mockResolvedValue({ active: false, scannedAt: null })

    const config = readConfigFromDb()
    config.netease.cookie = 'fixture-cookie'
    config.plex.server = 'plex.test'
    config.plex.token = 'fixture-token'
    config.download.dir = testDb.directory
    config.download.plexLibraryPathPrefix = '/music'
    config.sync.extraTrackRemovalPolicy = 'exact'
    config.sync.plexScanRetries = 0
    config.sync.plexScanRetryDelaySec = 0
    writeConfigToDb(config)

    const service = getSyncService(() => config)
    const prepared = service.prepareSyncForSource('source-1', { mode, trigger: 'user' })
    const state = await prepared.run()

    return {
      state,
      run: getRun(prepared.runId)!,
      source: getSource('source-1')!,
      failure: getFailureRecords([ignoredFailure.id])[0]!,
      cachedIgnoredPublishTime,
      downloadTaskCount: (getDb().prepare('SELECT COUNT(*) AS count FROM download_tasks').get() as { count: number }).count,
    }
  } finally {
    testDb.cleanup()
  }
}

function expectIgnoredBoundary(
  result: Awaited<ReturnType<typeof runIgnoredSync>>,
  options: { incompleteTarget: boolean },
) {
  expect(result.state.lastSyncResult).toBe('partial')
  expect(result.failure).toMatchObject({
    status: 'ignored',
    attemptCount: 3,
    occurrenceCount: 3,
    ignoreReason: 'manual',
  })

  expect(remote.fetchNeteaseSongDetails).toHaveBeenCalledTimes(1)
  expect(remote.fetchNeteaseSongDetails.mock.calls[0]?.[0]).toEqual([activeSongId])
  expect(remote.getTracksByRatingKeys.mock.calls.flatMap(call => call[0])).toEqual([activeRatingKey])
  expect(remote.getTrackByRatingKey).not.toHaveBeenCalled()
  expect(remote.findTracksByFilePath).not.toHaveBeenCalled()
  expect(remote.getRecentlyAddedTracks).not.toHaveBeenCalled()
  expect(result.downloadTaskCount).toBe(0)

  expect(remote.insertTrackIntoPlaylist).not.toHaveBeenCalled()
  expect(remote.insertTracksIntoPlaylist).not.toHaveBeenCalled()
  expect(remote.getPlaylistItemIds).not.toHaveBeenCalled()
  expect(remote.movePlaylistItemToTop).not.toHaveBeenCalled()
  expect(remote.movePlaylistItemAfter).not.toHaveBeenCalled()
  expect(remote.removeTrackFromPlaylist).not.toHaveBeenCalled()
  expect(result.source).toMatchObject({
    plexPlaylistRatingKey: 'playlist-1',
    lastStatus: 'partial',
  })

  const ignoredRunSong = result.run.songs.find(song => song.neteaseSongId === ignoredSongId)
  expect(ignoredRunSong).toMatchObject({ status: 'ignored_failure' })
  if (options.incompleteTarget) {
    expect(result.run.songs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: 'extra_skipped',
        metadata: expect.objectContaining({
          plexRatingKey: ignoredRatingKey,
          plexPlaylistItemId: 10,
        }),
      }),
    ]))
  } else {
    expect(ignoredRunSong).toMatchObject({
      album: 'Fixture Album',
      artist: 'Fixture Artist',
      metadata: { matchTrace: { ratingKey: ignoredRatingKey } },
    })
    expect(result.run.songs.some(song => song.status === 'extra_skipped')).toBe(false)
    expect(result.run.skippedSongs).toBe(1)
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  remote.insertTrackIntoPlaylist.mockRejectedValue(new Error('unexpected Plex insert'))
  remote.insertTracksIntoPlaylist.mockRejectedValue(new Error('unexpected Plex batch insert'))
  remote.getPlaylistItemIds.mockRejectedValue(new Error('unexpected Plex item lookup'))
  remote.movePlaylistItemToTop.mockRejectedValue(new Error('unexpected Plex move'))
  remote.movePlaylistItemAfter.mockRejectedValue(new Error('unexpected Plex move'))
  remote.removeTrackFromPlaylist.mockRejectedValue(new Error('unexpected Plex removal'))
})

describe.each(['full', 'redownload_managed'] as const)(
  'ignored songs during %s convergence',
  mode => {
    it('skips detail, matching and downloads while preserving the existing Plex item', async () => {
      const result = await runIgnoredSync(mode)
      expectIgnoredBoundary(result, { incompleteTarget: true })
    })
  },
)

it('keeps a cached complete-detail ignored binding out of matching and downloads', async () => {
  const result = await runIgnoredSync('full', { withIgnoredDetails: true })

  expect(result.cachedIgnoredPublishTime).toBe(1_700_000_000_000)
  expectIgnoredBoundary(result, { incompleteTarget: false })
})
