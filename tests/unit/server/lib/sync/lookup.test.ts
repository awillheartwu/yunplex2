import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb, initDb } from '~~/server/lib/db'
import type { AppConfig } from '~~/server/lib/config/types'
import type { NeteaseSong } from '~~/server/lib/netease'
import { getSongIdentityBinding, upsertSongIdentityBinding } from '~~/server/lib/sync/identity-store'
import { getLocalMediaAsset, upsertLocalMediaAsset } from '~~/server/lib/sync/local-media-store'
import { ensurePendingInitialization, upsertMediaDecision } from '~~/server/lib/source-initialization/store'

const getPlaylistTracks = vi.fn()
const getTrackByRatingKey = vi.fn()
const findTracksByFilePath = vi.fn()
vi.mock('~~/server/lib/plex-client', () => ({ getPlaylistTracks, getTrackByRatingKey, findTracksByFilePath }))

let root = ''
const song: NeteaseSong = { id: 357279, name: '无地自容', no: 8, dt: 339666, disc: '1', artists: [{ name: '黑豹乐队' }], album: { id: 35273, name: '黑豹', picUrl: '', publishTime: 662659200004 } }
function cfg(): AppConfig {
  return {
    netease: { cookie: '', quality: 'jymaster' }, plex: { server: '', port: 32400, token: '', section: '音乐' },
    download: { dir: root, plexLibraryPathPrefix: '/music', downloadLyrics: true, embedMetadata: true, embedCover: true, saveAlbumCover: false, saveArtistImage: false },
    sync: { intervalMinutes: 30, songLimit: 10, downloadConcurrency: 3, plexScanRetries: 5, plexScanRetryDelaySec: 15, enabled: false, logRetentionDays: 30, jobRetentionSuccessDays: 7, jobRetentionFailedDays: 30, downloadTaskRetentionDays: 30, forceFullCompare: false, reconcileOnPlexDrift: true, fullCompareAfterSkips: 5, fullCompareAfterDays: 7, autoDownloadAlbum: false, skipPlexPlaylist: false, skipRemoveExtraTracks: false, extraTrackRemovalPolicy: 'balanced', maxFailureAttempts: 3, unverifiedMediaPolicy: 'download_managed' },
    other: { multiArtistFormat: 'ampersand', lyricOrder: 'original_first', downloadTranslatedLyric: true, downloadRomajiLyric: false, artistAliases: {}, applyAliasToAlbum: false, pathFormat: '{artist}/{album}/{title} [netease-{songId}]', fontScale: 1 },
  }
}
function track(ratingKey: string, file: string, playlistItemID?: number) { return { ratingKey, title: '任意标题', grandparentTitle: '任意艺人', parentTitle: '任意专辑', playlistItemID, Media: [{ Part: [{ file }] }] } }

describe('safe media reuse', () => {
  beforeEach(() => { vi.resetAllMocks(); root = mkdtempSync(join(tmpdir(), 'reyunplex-lookup-')); initDb(root); getPlaylistTracks.mockResolvedValue([]); getTrackByRatingKey.mockResolvedValue(null); findTracksByFilePath.mockResolvedValue([]) })
  afterEach(() => { closeDb(); rmSync(root, { recursive: true, force: true }) })

  it('reuses a managed file by exact path regardless of Plex metadata', async () => {
    const local = join(root, 'managed.flac')
    writeFileSync(local, 'audio')
    upsertLocalMediaAsset({ neteaseSongId: song.id, filePath: local, provenance: 'download_task', ownership: 'managed', evidence: {} })
    findTracksByFilePath.mockResolvedValue([track('rk', '/music/managed.flac')])
    const { resolveTracks } = await import('~~/server/lib/sync/lookup')
    expect((await resolveTracks([song], '', '12', cfg())).resolutions[0]).toMatchObject({ resolution: 'found_in_plex_library', plexRatingKey: 'rk', matchTrace: { identity: { method: 'path' } } })
  })

  it('repairs a moved managed asset from an active path binding before downloading', async () => {
    const oldLocal = join(root, 'old-managed.flac')
    const movedLocal = join(root, 'Moved', 'managed.flac')
    mkdirSync(join(root, 'Moved'))
    writeFileSync(movedLocal, 'audio')
    upsertLocalMediaAsset({
      neteaseSongId: song.id,
      filePath: oldLocal,
      provenance: 'download_task',
      ownership: 'managed',
      evidence: { audioOperation: 'downloaded' },
    })
    upsertSongIdentityBinding({
      neteaseSongId: song.id,
      plexSectionKey: '12',
      plexSectionRoot: '/music',
      plexFilePath: '/music/Moved/managed.flac',
      plexRatingKey: 'managed-moved',
      bindingMethod: 'path',
      status: 'active',
      evidence: { source: 'managed_exact_path', ownership: 'managed' },
    })
    getTrackByRatingKey.mockResolvedValue(track('managed-moved', '/music/Moved/managed.flac', 7))
    getPlaylistTracks.mockResolvedValue([track('managed-moved', '/music/Moved/managed.flac', 7)])

    const { resolveTracks } = await import('~~/server/lib/sync/lookup')
    const result = await resolveTracks(
      [song],
      'playlist',
      '12',
      cfg(),
      false,
      {},
      { automaticMediaFallback: true },
    )

    expect(result.resolutions[0]).toMatchObject({
      resolution: 'matched_plex_playlist',
      plexRatingKey: 'managed-moved',
      matchTrace: { identity: { method: 'path' } },
    })
    expect(getLocalMediaAsset(song.id)).toMatchObject({
      filePath: movedLocal,
      ownership: 'managed',
      status: 'active',
    })
  })

  it('reuses external media only after explicit adoption', async () => {
    writeFileSync(join(root, 'external.flac'), 'audio')
    upsertSongIdentityBinding({ neteaseSongId: song.id, plexSectionKey: '12', plexSectionRoot: '/music', plexFilePath: '/music/external.flac', plexRatingKey: 'adopted', bindingMethod: 'manual', status: 'active', evidence: {} })
    getTrackByRatingKey.mockResolvedValue(track('adopted', '/music/external.flac', 7))
    getPlaylistTracks.mockResolvedValue([track('adopted', '/music/external.flac', 7)])
    const { resolveTracks } = await import('~~/server/lib/sync/lookup')
    expect((await resolveTracks([song], 'playlist', '12', cfg())).resolutions[0]).toMatchObject({ resolution: 'matched_plex_playlist', plexRatingKey: 'adopted', matchTrace: { identity: { method: 'manual' } } })
    expect(getLocalMediaAsset(song.id)).toMatchObject({
      filePath: join(root, 'external.flac'),
      provenance: 'manual',
      ownership: 'external',
      status: 'active',
    })
  })

  it('recovers Explicit Adoption when Plex changes ratingKey but keeps the exact path', async () => {
    writeFileSync(join(root, 'external.flac'), 'audio')
    upsertSongIdentityBinding({
      neteaseSongId: song.id,
      plexSectionKey: '12',
      plexSectionRoot: '/music',
      plexFilePath: '/music/external.flac',
      plexRatingKey: 'old-rating',
      bindingMethod: 'manual',
      status: 'active',
      evidence: {},
    })
    getTrackByRatingKey.mockResolvedValue(null)
    findTracksByFilePath.mockResolvedValue([track('new-rating', '/music/external.flac')])

    const { resolveTracks } = await import('~~/server/lib/sync/lookup')
    const resolution = (await resolveTracks([song], '', '12', cfg())).resolutions[0]

    expect(resolution).toMatchObject({
      resolution: 'found_in_plex_library',
      plexRatingKey: 'new-rating',
      matchTrace: { identity: { method: 'manual' } },
    })
    expect(getSongIdentityBinding(song.id)).toMatchObject({
      plexRatingKey: 'new-rating',
      bindingMethod: 'manual',
      status: 'active',
    })
  })

  it('does not reuse an external exact path without Explicit Adoption', async () => {
    const external = join(root, 'external.flac')
    writeFileSync(external, 'audio')
    upsertLocalMediaAsset({
      neteaseSongId: song.id,
      filePath: external,
      provenance: 'manual',
      ownership: 'external',
      evidence: {},
    })
    findTracksByFilePath.mockResolvedValue([track('external', '/music/external.flac')])

    const { resolveTracks } = await import('~~/server/lib/sync/lookup')
    expect((await resolveTracks([song], '', '12', cfg())).resolutions[0]).toMatchObject({
      resolution: 'needs_download',
      matchTrace: { source: 'download_required' },
    })
  })

  it('falls back safely when Explicit Adoption no longer resolves', async () => {
    upsertSongIdentityBinding({
      neteaseSongId: song.id,
      plexSectionKey: '12',
      plexSectionRoot: '/music',
      plexFilePath: '/music/missing.flac',
      plexRatingKey: 'missing',
      bindingMethod: 'manual',
      status: 'active',
      evidence: {},
    })

    const { resolveTracks } = await import('~~/server/lib/sync/lookup')
    const resolution = (await resolveTracks([song], '', '12', cfg())).resolutions[0]

    expect(resolution).toMatchObject({
      resolution: 'needs_download',
      matchTrace: { source: 'download_required' },
    })
    expect(getSongIdentityBinding(song.id)?.status).toBe('stale')
  })

  it('downloads when there is no verified identity instead of guessing metadata', async () => {
    const { resolveTracks } = await import('~~/server/lib/sync/lookup')
    expect((await resolveTracks([song], '', '12', cfg())).resolutions[0]).toMatchObject({ resolution: 'needs_download', matchTrace: { source: 'download_required' } })
  })

  it('waits for an explicit choice when the unverified-media policy requests it', async () => {
    const config = cfg()
    config.sync.unverifiedMediaPolicy = 'wait_manual'
    const { resolveTracks } = await import('~~/server/lib/sync/lookup')
    expect((await resolveTracks([song], '', '12', config)).resolutions[0]).toMatchObject({
      resolution: 'awaiting_manual',
      mediaPolicy: { disposition: 'wait_manual' },
      matchTrace: { source: 'media_policy' },
    })
  })

  it('honors sparse first-adoption defer decisions without affecting future songs', async () => {
    const now = new Date().toISOString()
    getDb().prepare(`INSERT INTO playlist_sources (
      id, netease_playlist_id, name, enabled, netease_playlist_name, created_at, updated_at
    ) VALUES ('source-1', 1, 'Source', 1, 'Source', ?, ?)`)
      .run(now, now)
    const initialization = ensurePendingInitialization('source-1')
    upsertMediaDecision('source-1', song.id, 'defer', initialization.id)
    const { resolveTracks } = await import('~~/server/lib/sync/lookup')

    const deferred = await resolveTracks([song], '', '12', cfg(), false, { sourceId: 'source-1' }, { automaticMediaFallback: true })
    const futureSong = { ...song, id: song.id + 1 }
    const normal = await resolveTracks([futureSong], '', '12', cfg(), false, { sourceId: 'source-1' }, { automaticMediaFallback: true })

    expect(deferred.resolutions[0]).toMatchObject({ resolution: 'awaiting_manual' })
    expect(normal.resolutions[0]).toMatchObject({ resolution: 'needs_download' })
  })

  it('stops when multiple Plex items claim one managed path', async () => {
    const local = join(root, 'managed.flac')
    writeFileSync(local, 'audio')
    upsertLocalMediaAsset({ neteaseSongId: song.id, filePath: local, provenance: 'download_task', ownership: 'managed', evidence: {} })
    findTracksByFilePath.mockResolvedValue([track('a', '/music/managed.flac'), track('b', '/music/managed.flac')])
    const { resolveTracks } = await import('~~/server/lib/sync/lookup')
    expect((await resolveTracks([song], '', '12', cfg())).resolutions[0]).toMatchObject({ resolution: 'unavailable', matchTrace: { source: 'identity_conflict' } })
  })
})
