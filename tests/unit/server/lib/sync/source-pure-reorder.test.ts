import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_CONFIG } from '~~/server/lib/config/defaults'
import { closeDb, initDb, writeConfigToDb } from '~~/server/lib/db'
import type { NeteaseSong } from '~~/server/lib/netease'
import { createSource, getSource, updateSource } from '~~/server/lib/playlist/store'
import { RunBuilder } from '~~/server/lib/run/builder'
import { upsertVerifiedSongIdentityBinding } from '~~/server/lib/sync/identity-store'
import { tryApplyPureSourceReorder } from '~~/server/lib/sync/source-pure-reorder'
import { applyFullReorder } from '~~/server/lib/sync/plex-reconciler'
import { validateCachedTargetOrder } from '~~/server/lib/sync/reorder-cache'
import {
  getPlaylistByRatingKey,
  getPlaylistWriteTracks,
  getSectionKey,
} from '~~/server/lib/plex-client'

vi.mock('~~/server/lib/sync/reorder-cache', () => ({ validateCachedTargetOrder: vi.fn() }))
vi.mock('~~/server/lib/sync/plex-reconciler', () => ({ applyFullReorder: vi.fn() }))
vi.mock('~~/server/lib/plex-client', async importOriginal => ({
  ...await importOriginal<typeof import('~~/server/lib/plex-client')>(),
  findPlaylist: vi.fn(),
  getPlaylistByRatingKey: vi.fn(),
  getPlaylistWriteTracks: vi.fn(),
  getTracksByRatingKeys: vi.fn(async () => new Map()),
  assertPlexClientConfig: vi.fn(),
  getSectionKey: vi.fn(),
  initPlexClient: vi.fn(),
}))

const tempDirs: string[] = []

afterEach(() => {
  closeDb()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  vi.clearAllMocks()
})

function song(): NeteaseSong {
  return {
    id: 1,
    name: 'Song',
    no: 1,
    dt: 180_000,
    disc: '1',
    artists: [{ name: 'Artist' }],
    album: { id: 1, name: 'Album', picUrl: '', publishTime: 0 },
  }
}

describe('pure Source reorder', () => {
  it('applies, reads back, and records a cache-proven reorder', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reyunplex-pure-reorder-'))
    tempDirs.push(dir)
    initDb(dir)
    const persistedSource = await createSource(1, '', { type: 'album', name: 'Source' })
    const source = updateSource(persistedSource.id, { plexPlaylistRatingKey: 'playlist-1' })!
    writeFileSync(join(dir, 'song.flac'), 'fLaCfixture')
    const config = structuredClone(DEFAULT_CONFIG)
    config.download.dir = dir
    config.download.plexLibraryPathPrefix = '/music'
    writeConfigToDb(config)
    upsertVerifiedSongIdentityBinding({
      neteaseSongId: 1,
      plexSectionKey: '12',
      plexFilePath: '/music/song.flac',
      plexRatingKey: 'rating-1',
      bindingMethod: 'path',
      status: 'active',
      evidence: {},
    })
    vi.mocked(validateCachedTargetOrder).mockResolvedValue({
      targetOrder: ['rating-1'],
      issues: [],
    })
    vi.mocked(getPlaylistByRatingKey).mockResolvedValue({
      ratingKey: 'playlist-1',
      title: 'Source', playlistType: 'audio', smart: 0,
    })
    vi.mocked(getSectionKey).mockResolvedValue('12')
    vi.mocked(getPlaylistWriteTracks).mockResolvedValue([{
      ratingKey: 'rating-1',
      playlistItemID: 10,
      title: 'Song',
      grandparentTitle: 'Artist',
      parentTitle: 'Album',
      Media: [{ Part: [{ file: '/music/song.flac' }] }],
    }])
    vi.mocked(applyFullReorder).mockResolvedValue({
      inserted: 0, removed: 0, moved: 0, preserved: 0, mutations: [], failures: [],
    })
    const job = new RunBuilder(false)

    const handled = await tryApplyPureSourceReorder({
      source,
      songs: [song()],
      config,
      job,
      stepContext: { sourceId: source.id },
      dryRun: false,
      currentIdOrder: [1],
      isCancellationRequested: () => false,
      throwIfCancelled: () => undefined,
      log: () => undefined,
    })

    expect(handled?.plexPlaylist.ratingKey).toBe(source.plexPlaylistRatingKey)
    expect(applyFullReorder).toHaveBeenCalledOnce()
    expect(getPlaylistWriteTracks).toHaveBeenCalledTimes(2)
    expect(job.getRun().steps).toMatchObject([{ type: 'reorder', status: 'success' }])
    expect(getSource(source.id)?.lastAppliedPlexFingerprint).toMatch(/^plex-playlist-v1:/)
  })
})
