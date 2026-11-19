import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, initDb, writeConfigToDb } from '~~/server/lib/db'
import { DEFAULT_CONFIG } from '~~/server/lib/config/defaults'
import { createSource, updateSource } from '~~/server/lib/playlist/store'
import { RunBuilder } from '~~/server/lib/run/builder'
import { captureBindingVersions } from '~~/server/lib/sync/identity-coordinator'
import { captureSourceConvergenceCheckpoint } from '~~/server/lib/sync/source-checkpoint'
import { reconcilePlexPlaylist } from '~~/server/lib/sync/source-plex-reconciliation'
import { getSongIdentityBinding, unbindSongIdentityWithMode, upsertSongIdentityBinding } from '~~/server/lib/sync/identity-store'
import { getPlaylistWriteTracks } from '~~/server/lib/plex-client'
import { applyFullReorder } from '~~/server/lib/sync/plex-reconciler'
import type { TrackResolution } from '~~/server/lib/sync/types'

vi.mock('~~/server/lib/plex-client', async importOriginal => ({
  ...await importOriginal<typeof import('~~/server/lib/plex-client')>(),
  getPlaylistWriteTracks: vi.fn(),
  assertPlexClientConfig: vi.fn(),
}))
vi.mock('~~/server/lib/sync/plex-reconciler', () => ({ applyFullReorder: vi.fn(), triggerRescan: vi.fn() }))

let directory = ''
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'yunplex-deferred-write-')); initDb(directory) })
afterEach(() => { closeDb(); rmSync(directory, { recursive: true, force: true }); vi.clearAllMocks() })

async function fixture() {
  const config = structuredClone(DEFAULT_CONFIG)
  config.download.dir = directory
  config.download.plexLibraryPathPrefix = '/music'
  writeConfigToDb(config)
  const created = await createSource(1, '', { type: 'album', name: 'Disposable source', coverUrl: '/fixture-cover' })
  const source = updateSource(created.id, { plexPlaylistRatingKey: '123', plexPlaylistName: 'Disposable source' })!
  for (const id of [1, 2]) {
    writeFileSync(join(directory, `${id}.flac`), 'fLaC')
    upsertSongIdentityBinding({ neteaseSongId: id, plexSectionKey: '12', plexSectionRoot: '/music',
      plexFilePath: `/music/${id}.flac`, plexRatingKey: String(id), bindingMethod: 'manual', status: 'active', evidence: {} })
  }
  unbindSongIdentityWithMode({ neteaseSongId: 1, expectedBindingUpdatedAt: getSongIdentityBinding(1)!.updatedAt, mode: 'exclude_current' })
  const resolutions: TrackResolution[] = [1, 2].map(id => ({
    song: { id, name: `Song ${id}`, no: id, dt: 180000, disc: '1', artists: [{ name: 'Artist' }],
      album: { id: 1, name: 'Album', picUrl: '', publishTime: 0 } },
    neteaseIndex: id - 1,
    resolution: id === 1 ? 'awaiting_manual' : 'found_in_plex_library',
    ...(id === 2 ? { plexRatingKey: '2', matchTrace: { source: 'identity_binding' as const,
      identity: { method: 'manual' as const, plexFilePath: '/music/2.flac' } } } : {}),
  }))
  const job = new RunBuilder(false)
  job.addSongs(source.id, resolutions.map(item => ({ songName: item.song.name, artist: 'Artist', album: 'Album',
    neteaseSongId: item.song.id, neteaseIndex: item.neteaseIndex, status: item.song.id === 1 ? 'awaiting_manual_match' : 'skipped_existing' })))
  const tracks = [{ ratingKey: '2', playlistItemID: 20, title: 'Song 2', grandparentTitle: 'Artist', parentTitle: 'Album',
    Media: [{ Part: [{ file: '/music/2.flac' }] }] }]
  vi.mocked(getPlaylistWriteTracks).mockResolvedValue(tracks)
  vi.mocked(applyFullReorder).mockImplementation(async (...args) => {
    args[6]?.owner?.assertCurrent()
    return { inserted: 0, removed: 0, moved: 0, preserved: 0, mutations: [], failures: [] }
  })
  return { source, resolutions, config, job, tracks }
}

describe('deferred identity at the final Plex write boundary', () => {
  async function reconcile(value: Awaited<ReturnType<typeof fixture>>) {
    return reconcilePlexPlaylist({ ...value, extraTaskIds: new Map(), stepContext: { sourceId: value.source.id },
      plexPlaylist: { ratingKey: '123', title: 'Disposable source' }, sectionKey: '12', currentIdOrder: [1, 2],
      bindingVersionSnapshot: captureBindingVersions([1, 2]), bindingRatingKeys: captureSourceConvergenceCheckpoint([1, 2]).plexRatingKeys,
      emptyTargetConfirmed: false, skipRemoveExtra: false, retryUnresolvedSnapshot: false, needsPlexRefresh: false,
      splitArtists: () => ['Artist', 'Artist'], isCancellationRequested: () => false, throwIfCancelled: () => {},
      setStage: () => {}, log: () => {} })
  }

  it('preserves an unchanged deferred choice while confirming the other song in Plex', async () => {
    const value = await fixture()
    await expect(reconcile(value)).resolves.toBeDefined()
    expect(applyFullReorder).toHaveBeenCalledOnce()
    expect(getSongIdentityBinding(1)?.status).toBe('unbound')
  })

  it('blocks a changed deferred choice during readback, then permits a fresh run', async () => {
    const value = await fixture()
    vi.mocked(getPlaylistWriteTracks).mockImplementationOnce(async () => {
      unbindSongIdentityWithMode({ neteaseSongId: 1, expectedBindingUpdatedAt: getSongIdentityBinding(1)!.updatedAt, mode: 'exclude_current' })
      return value.tracks
    })
    await expect(reconcile(value)).rejects.toThrow('身份已变化')
    expect(applyFullReorder).not.toHaveBeenCalled()
    await expect(reconcile(value)).resolves.toBeDefined()
    expect(applyFullReorder).toHaveBeenCalledOnce()
  })
})
