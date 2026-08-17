import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_CONFIG } from '../config/defaults'
import { closeDb, initDb } from '../db'
import type { NeteaseSong } from '../netease'
import { createSource, getSource } from '../playlist/store'
import { RunBuilder } from '../run/builder'
import { upsertVerifiedSongIdentityBinding } from './identity-store'
import { tryApplyPureSourceReorder } from './source-pure-reorder'
import { applyFullReorder } from './plex-reconciler'
import { validateCachedTargetOrder } from './reorder-cache'
import {
  getPlaylistByRatingKey,
  getPlaylistTracks,
  getSectionKey,
} from '../plex-client'

vi.mock('./reorder-cache', () => ({ validateCachedTargetOrder: vi.fn() }))
vi.mock('./plex-reconciler', () => ({ applyFullReorder: vi.fn() }))
vi.mock('../plex-client', () => ({
  findPlaylist: vi.fn(),
  getPlaylistByRatingKey: vi.fn(),
  getPlaylistTracks: vi.fn(),
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
    const source = { ...persistedSource, plexPlaylistRatingKey: 'playlist-1' }
    upsertVerifiedSongIdentityBinding({
      neteaseSongId: 1,
      plexSectionKey: '12',
      plexFilePath: '/music/song.flac',
      plexRatingKey: 'rating-1',
      mbRecordingId: null,
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
      title: 'Source',
    })
    vi.mocked(getSectionKey).mockResolvedValue('12')
    vi.mocked(getPlaylistTracks).mockResolvedValue([{
      ratingKey: 'rating-1',
      playlistItemID: 10,
      title: 'Song',
      grandparentTitle: 'Artist',
      parentTitle: 'Album',
    }])
    vi.mocked(applyFullReorder).mockResolvedValue({ mutations: [], failures: [] })
    const job = new RunBuilder(false)

    const handled = await tryApplyPureSourceReorder({
      source,
      songs: [song()],
      config: DEFAULT_CONFIG,
      job,
      stepContext: { sourceId: source.id },
      dryRun: false,
      currentIdOrder: [1],
      isCancellationRequested: () => false,
      throwIfCancelled: () => undefined,
      log: () => undefined,
    })

    expect(handled).toBe(true)
    expect(applyFullReorder).toHaveBeenCalledOnce()
    expect(getPlaylistTracks).toHaveBeenCalledTimes(2)
    expect(job.getRun().steps).toMatchObject([{ type: 'reorder', status: 'success' }])
    expect(getSource(source.id)?.lastAppliedPlexFingerprint).toMatch(/^plex-playlist-v1:/)
  })
})
