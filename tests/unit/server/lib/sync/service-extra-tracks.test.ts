import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_CONFIG } from '~~/server/lib/config/defaults'
import { closeDb, initDb } from '~~/server/lib/db'
import type { NeteaseSong } from '~~/server/lib/netease'
import type { PlexTrack } from '~~/server/lib/plex-client'
import { createSource, getSource, updateSource } from '~~/server/lib/playlist/store'
import type { RunBuilder } from '~~/server/lib/run/builder'
import { getRun } from '~~/server/lib/run/store'
import { getSyncService } from '~~/server/lib/sync/service'
import type { SyncMode } from '~~/server/lib/sync/service-state'

const remote = vi.hoisted(() => ({
  fetchPlaylistSongs: vi.fn(),
  getPlaylistSnapshotByRatingKey: vi.fn(),
  getPlaylistTracks: vi.fn(),
  getTrackByRatingKey: vi.fn(),
  reconcileSource: vi.fn(),
  matchTracksInPlexWithRetry: vi.fn(),
}))

vi.mock('~~/server/lib/netease', () => ({
  checkCookie: async () => ({ valid: true }),
  fetchPlaylistSongs: remote.fetchPlaylistSongs,
  clearAlbumCache: () => undefined,
  setArtistAliases: () => undefined,
}))
vi.mock('~~/server/lib/plex-client', () => ({
  initPlexClient: async () => undefined,
  getPlaylistSnapshotByRatingKey: remote.getPlaylistSnapshotByRatingKey,
  getPlaylistTracks: remote.getPlaylistTracks,
  getTrackByRatingKey: remote.getTrackByRatingKey,
  getPlaylistUpdatedAt: async () => 1,
}))
vi.mock('~~/server/lib/sync/plex-reconciler', () => ({
  reconcileSource: remote.reconcileSource,
  triggerRescan: async () => undefined,
  applyFullReorder: async () => ({ mutations: [] }),
}))
vi.mock('~~/server/lib/sync/plex-batch-match', () => ({
  matchTracksInPlexWithRetry: remote.matchTracksInPlexWithRetry,
}))
vi.mock('~~/server/lib/sync/source-downloads', () => ({
  applySourceDownloads: async () => ({ needsPlexRefresh: false, downloadTargetCount: 0 }),
}))

const song: NeteaseSong = {
  id: 1, name: 'Song', no: 1, dt: 180_000, disc: '1',
  artists: [{ name: 'Artist' }],
  album: { id: 1, name: 'Album', picUrl: '', publishTime: 0 },
}

let directory: string

beforeEach(() => {
  vi.clearAllMocks()
  directory = mkdtempSync(join(tmpdir(), 'reyunplex-final-extras-'))
  initDb(directory)
})

afterEach(() => {
  closeDb()
  rmSync(directory, { recursive: true, force: true })
})

async function runComparison(hasRetainedExtra: boolean, mode: SyncMode = 'full') {
  const source = await createSource(42, '', { name: 'Source' })
  updateSource(source.id, { plexPlaylistRatingKey: 'playlist-1', initializeMediaOnFirstSync: false })
  const config = structuredClone(DEFAULT_CONFIG)
  config.netease.cookie = 'test-cookie'
  config.plex.server = 'plex.test'
  config.plex.token = 'test-token'
  config.download.dir = directory
  config.download.plexLibraryPathPrefix = '/music'
  config.sync.extraTrackRemovalPolicy = 'balanced'
  const localPath = join(directory, 'song.flac')
  writeFileSync(localPath, 'test audio')
  const target: PlexTrack = {
    ratingKey: 'target-1', playlistItemID: 10, title: song.name,
    grandparentTitle: 'Artist', parentTitle: 'Album',
    Media: [{ Part: [{ file: '/music/song.flac' }] }],
  }
  const extra: PlexTrack = {
    ratingKey: 'old-1', playlistItemID: 11, title: 'Old version',
    grandparentTitle: 'Artist', parentTitle: 'Album',
  }
  const tracks = hasRetainedExtra ? [target, extra] : [target]
  remote.fetchPlaylistSongs.mockResolvedValue({
    songs: [song], trackIds: [{ id: 1 }], allTrackIds: [{ id: 1 }],
    trackUpdateTime: 1, playlistName: 'Source',
  })
  remote.getPlaylistSnapshotByRatingKey.mockResolvedValue({ updatedAt: 1, tracks })
  remote.getPlaylistTracks.mockResolvedValue(tracks)
  remote.getTrackByRatingKey.mockResolvedValue(target)
  remote.matchTracksInPlexWithRetry.mockResolvedValue(new Map([['0', {
    ratingKey: target.ratingKey, matchedBy: 'recent_path_lookup', attempts: 1,
    localFilePath: localPath, traces: [],
  }]]))
  let job: RunBuilder | undefined
  remote.reconcileSource.mockImplementation(async (_source, _songs, _config, builder) => {
    job = builder
    return {
      resolutions: [{ song, neteaseIndex: 0, resolution: 'found_on_disk', filePath: localPath }],
      plexPlaylist: { ratingKey: 'playlist-1', title: 'Source' },
      sectionKey: '12',
      // The initial comparison has not yet recognized the target's file path.
      extraTracks: tracks.map(track => ({
        ratingKey: track.ratingKey, playlistItemId: track.playlistItemID,
        title: track.title, artist: 'Artist', album: 'Album', protectionReason: 'Unresolved identity',
      })),
    }
  })
  const service = getSyncService(() => config)
  const prepared = service.prepareSyncForSource(source.id, { mode, trigger: 'user' })
  const state = await prepared.run()
  return { state, run: mode === 'preview' ? job!.getRun() : getRun(prepared.runId)!, source: getSource(source.id)! }
}

describe('final extra-track accounting', () => {
  it('does not retain a warning when the final path lookup recognizes the only provisional extra as a target', async () => {
    const { state, run, source } = await runComparison(false)
    expect(state.lastSyncResult).toBe('success')
    expect(source.lastStatus).toBe('success')
    expect(run).toMatchObject({ totalSongs: 1, successSongs: 1, failedSongs: 0, warnings: 0 })
    expect(run.songs.filter(item => item.status === 'extra_skipped')).toEqual([])
  })

  it('counts only the remaining old occurrence after a provisional extra becomes a verified target', async () => {
    const { state, run } = await runComparison(true)
    expect(state.lastSyncResult).toBe('partial')
    expect(run).toMatchObject({ totalSongs: 1, successSongs: 1, failedSongs: 0, warnings: 1 })
    expect(run.songs.filter(item => item.status === 'extra_skipped')).toMatchObject([{
      songName: 'Old version', metadata: { plexPlaylistItemId: 11 },
    }])
  })

  it('keeps initial comparison details in preview without running the final Plex lookup', async () => {
    const { run } = await runComparison(true, 'preview')
    expect(remote.matchTracksInPlexWithRetry).not.toHaveBeenCalled()
    expect(run.songs.filter(item => item.status === 'extra_skipped').map(item => item.songName))
      .toEqual(['Song', 'Old version'])
  })
})
