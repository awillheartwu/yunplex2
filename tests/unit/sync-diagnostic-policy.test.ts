import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_CONFIG } from '~~/server/lib/config/defaults'
import { closeDb, initDb } from '~~/server/lib/db'
import { readLogs } from '~~/server/lib/log/store'
import type { NeteaseSong } from '~~/server/lib/netease'
import { createSource, updateSource } from '~~/server/lib/playlist/store'
import { upsertSongIdentityBinding } from '~~/server/lib/sync/identity-store'
import { getSyncService } from '~~/server/lib/sync/service'

const remote = vi.hoisted(() => ({
  checkCookie: vi.fn(),
  fetchPlaylistSummary: vi.fn(),
  fetchNeteaseSongDetails: vi.fn(),
  reconcileSource: vi.fn(),
}))

vi.mock('~~/server/lib/netease', () => ({
  checkCookie: remote.checkCookie,
  fetchPlaylistSummary: remote.fetchPlaylistSummary,
  fetchNeteaseSongDetails: remote.fetchNeteaseSongDetails,
  fetchAlbumSongs: vi.fn(),
  mapRawSong: vi.fn(),
  findInvalidRawSongField: vi.fn(() => null),
  clearAlbumCache: vi.fn(),
  setArtistAliases: vi.fn(),
}))

vi.mock('~~/server/lib/sync/plex-reconciler', () => ({
  reconcileSource: remote.reconcileSource,
  triggerRescan: vi.fn(),
  applyFullReorder: vi.fn(),
}))

const song: NeteaseSong = {
  id: 1,
  name: 'Diagnostic Song',
  no: 1,
  dt: 180_000,
  disc: '1',
  artists: [{ name: 'Diagnostic Artist' }],
  album: { id: 1, name: 'Diagnostic Album', picUrl: '', publishTime: 0 },
}

let directory: string

beforeEach(() => {
  vi.resetAllMocks()
  directory = mkdtempSync(join(tmpdir(), 'reyunplex-sync-diagnostics-'))
  initDb(directory)
  remote.checkCookie.mockResolvedValue({ valid: true })
})

afterEach(() => {
  closeDb()
  rmSync(directory, { recursive: true, force: true })
})

function config() {
  const value = structuredClone(DEFAULT_CONFIG)
  value.netease.cookie = 'fixture-cookie'
  value.plex.server = 'plex.test'
  value.plex.token = 'fixture-token'
  value.download.dir = directory
  value.sync.initializeMediaOnFirstSync = false
  return value
}

async function source(name: string) {
  const created = await createSource(42, '', { name })
  updateSource(created.id, { initializeMediaOnFirstSync: false })
  return created
}

describe('sync diagnostic logging policy', () => {
  it('persists a warning produced while a real sync run receives incomplete song details', async () => {
    const appConfig = config()
    const target = await source('Incomplete playlist')
    remote.fetchPlaylistSummary.mockResolvedValue({
      trackIds: [{ id: 1 }, { id: 2 }],
      allTrackIds: [{ id: 1 }, { id: 2 }],
      trackUpdateTime: 10,
      playlistName: target.name,
      playlist: null,
    })
    remote.fetchNeteaseSongDetails.mockResolvedValue({ songs: [song], rawSongs: [] })
    remote.reconcileSource.mockResolvedValue({
      resolutions: [{ song, neteaseIndex: 0, resolution: 'found_in_plex_library', plexRatingKey: 'plex-song-1' }],
      plexPlaylist: { ratingKey: '', title: target.name },
      sectionKey: '',
      extraTracks: [],
    })

    const service = getSyncService(() => appConfig)
    await service.prepareSyncForSource(target.id, { mode: 'preview', trigger: 'user' }).run()

    const { items, total } = readLogs({ level: 'warn' })
    expect(total).toBe(1)
    expect(items[0]).toMatchObject({
      level: 'warn',
      stage: 'fetching_playlist',
    })
    expect(items[0]?.message).toContain('2 个 trackId')
    expect(items[0]?.message).toContain('1 首缺少歌曲详情')
  })

  it('persists a service failure as an error diagnostic', async () => {
    const appConfig = config()
    const target = await source('Broken playlist')
    remote.fetchPlaylistSummary.mockRejectedValue(new Error('fixture upstream unavailable'))

    const service = getSyncService(() => appConfig)
    const prepared = service.prepareSyncForSource(target.id, { mode: 'normal', trigger: 'user' })
    const state = await prepared.run()

    expect(state.lastSyncResult).toBe('failure')
    const { items, total } = readLogs({ level: 'error' })
    expect(total).toBe(1)
    expect(items[0]).toMatchObject({
      level: 'error',
      stage: 'fetching_playlist',
    })
    expect(items[0]?.message).toContain('Broken playlist')
    expect(items[0]?.message).toContain('fixture upstream unavailable')
    expect(readLogs().total).toBe(1)
  })

  it('keeps an unchanged, successful sync out of the diagnostic log', async () => {
    const appConfig = config()
    const target = await source('Unchanged playlist')
    updateSource(target.id, {
      lastStatus: 'success',
      lastTrackUpdateTime: 7,
      trackIdSnapshot: JSON.stringify([1]),
    })
    upsertSongIdentityBinding({
      neteaseSongId: 1,
      plexSectionKey: '12',
      plexFilePath: '/music/diagnostic-song.flac',
      plexRatingKey: 'plex-song-1',
      bindingMethod: 'manual',
      status: 'active',
      evidence: {},
    })
    remote.fetchPlaylistSummary.mockResolvedValue({
      trackIds: [{ id: 1 }],
      allTrackIds: [{ id: 1 }],
      trackUpdateTime: 7,
      playlistName: target.name,
      playlist: null,
    })
    remote.fetchNeteaseSongDetails.mockResolvedValue({ songs: [song], rawSongs: [] })

    const service = getSyncService(() => appConfig)
    const prepared = service.prepareSyncForSource(target.id, { mode: 'normal', trigger: 'user' })
    const state = await prepared.run()

    expect(state.lastSyncResult).toBe('success')
    expect(remote.reconcileSource).not.toHaveBeenCalled()
    expect(readLogs()).toMatchObject({ total: 0, items: [] })
  })
})
