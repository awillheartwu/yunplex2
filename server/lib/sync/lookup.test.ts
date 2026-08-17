import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { closeDb, getDb, initDb } from '../db'
import type { AppConfig } from '../config/types'
import type { NeteaseSong } from '../netease'
import {
  createMatchReview,
  decideMatchReview,
  getSongIdentityBinding,
  queryMatchReviews,
  upsertSongIdentityBinding,
} from './identity-store'
import { upsertLocalMediaAsset } from './local-media-store'

const getPlaylistTracks = vi.fn()
const getTrackByRatingKey = vi.fn()
const getTrackFilePathsByRatingKey = vi.fn()
const findTrackByFilePath = vi.fn()
const findTracksByFilePath = vi.fn()
const searchTrackCandidates = vi.fn()
const resolveSongArtistCandidateNames = vi.fn()
const resolveRecording = vi.fn()
const resolveMusicBrainzIdToRecording = vi.fn()
const getPlexTrackMusicBrainzIdentity = vi.fn()
const getPlexTrackNeteaseIdentity = vi.fn()

vi.mock('../plex-client', () => ({
  getPlaylistTracks,
  getTrackByRatingKey,
  getTrackFilePathsByRatingKey,
  findTrackByFilePath,
  findTracksByFilePath,
  searchTrackCandidates,
  getPlexTrackMusicBrainzIdentity,
  getPlexTrackNeteaseIdentity,
  getPlexTrackRecordingId: () => null,
}))

vi.mock('./song-artist-candidates', () => ({ resolveSongArtistCandidateNames }))
vi.mock('../integrations/musicbrainz', () => ({ resolveRecording, resolveMusicBrainzIdToRecording }))

let root: string | null = null

function config(downloadDir: string): AppConfig {
  return {
    netease: { cookie: '', quality: 'jymaster' },
    plex: { server: '', port: 32400, token: '', section: '音乐' },
    download: { dir: downloadDir, plexLibraryPathPrefix: '/volume1/06_Music', downloadLyrics: true, embedMetadata: true, embedCover: true, saveAlbumCover: false, saveArtistImage: false },
    sync: { intervalMinutes: 30, songLimit: 10, downloadConcurrency: 3, plexScanRetries: 5, plexScanRetryDelaySec: 15, enabled: false, logRetentionDays: 30, jobRetentionSuccessDays: 7, jobRetentionFailedDays: 90, downloadTaskRetentionDays: 30, activityRetentionDays: 30, forceFullCompare: false, downloadWhenMediaMissing: false, reconcileOnPlexDrift: true, fullCompareAfterSkips: 5, fullCompareAfterDays: 7, autoDownloadAlbum: false, skipPlexPlaylist: false, skipRemoveExtraTracks: false, extraTrackRemovalPolicy: 'balanced', maxFailureAttempts: 3 },
    other: { multiArtistFormat: 'ampersand', lyricOrder: 'original_first', downloadTranslatedLyric: true, downloadRomajiLyric: false, artistAliases: {}, applyAliasToAlbum: false, pathFormat: '{artist}/{album} ({year})/{track:02d} - {title}', fontScale: 1, enableMusicBrainzResolver: false, musicBrainzMinScore: 90 },
  }
}

const song: NeteaseSong = {
  id: 357279,
  name: '无地自容',
  no: 8,
  dt: 339666,
  disc: '1',
  artists: [{ name: '黑豹乐队' }],
  album: { id: 35273, name: '黑豹', picUrl: '', publishTime: 662659200004 },
}

describe('track identity lookup', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    root = mkdtempSync(join(tmpdir(), 'reyunplex-lookup-'))
    initDb(root)
    resolveSongArtistCandidateNames.mockResolvedValue(['黑豹乐队'])
    resolveRecording.mockResolvedValue(null)
    resolveMusicBrainzIdToRecording.mockResolvedValue({
      inputId: '', recordingId: null, entityType: 'unknown', status: 'empty',
      candidateRecordingIds: [], failureReason: null, cacheHit: false,
    })
    getPlexTrackMusicBrainzIdentity.mockReturnValue({ explicitRecordingId: null, untypedIds: [], rawGuids: [] })
    getPlexTrackNeteaseIdentity.mockReturnValue(null)
    searchTrackCandidates.mockResolvedValue({ match: null, candidates: [] })
    findTrackByFilePath.mockResolvedValue(null)
    findTracksByFilePath.mockResolvedValue([])
    getTrackByRatingKey.mockResolvedValue(null)
    getTrackFilePathsByRatingKey.mockResolvedValue([])
  })

  afterEach(() => {
    closeDb()
    if (root) rmSync(root, { recursive: true, force: true })
    root = null
  })

  it('binds the exact Plex media path before considering drifted metadata', async () => {
    const localPath = join(root!, '黑豹乐队/黑豹 (1991)/08 - 无地自容.flac')
    mkdirSync(dirname(localPath), { recursive: true })
    writeFileSync(localPath, 'audio')
    upsertLocalMediaAsset({
      neteaseSongId: song.id,
      filePath: localPath,
      provenance: 'download_task',
      ownership: 'managed',
      evidence: { audioOperation: 'downloaded' },
    })
    const exactTrack = {
      ratingKey: '43514',
      playlistItemID: 5625,
      title: '无地自容',
      grandparentTitle: '黑屋乐队',
      parentTitle: '黑豹',
      Media: [{ Part: [{ file: '/volume1/06_Music/黑豹乐队/黑豹 (1991)/08 - 无地自容.flac' }] }],
    }
    const oldMetadataMatch = {
      ratingKey: '10603',
      playlistItemID: 5516,
      title: '无地自容',
      grandparentTitle: '黑豹乐队',
      parentTitle: '黑豹',
      Media: [{ Part: [{ file: '/volume1/06_Music/黑豹乐队/黑豹/08. 无地自容.flac' }] }],
    }
    getPlaylistTracks.mockResolvedValue([oldMetadataMatch, exactTrack])

    const { resolveTracks } = await import('./lookup')
    const result = await resolveTracks([song], '43411', '12', config(root!), false, { sourceId: 'source', runId: 'run' })

    expect(result.resolutions[0]).toMatchObject({
      resolution: 'matched_plex_playlist',
      plexRatingKey: '43514',
      playlistItemId: 5625,
      matchTrace: { source: 'identity_binding', identity: { method: 'path' } },
    })
    expect(result.extraTracks).toEqual(expect.arrayContaining([expect.objectContaining({ playlistItemId: 5516 })]))
  })

  it('lets a managed exact path supersede an older automatic binding', async () => {
    const localPath = join(root!, '黑豹乐队/黑豹 (1991)/08 - 无地自容.flac')
    mkdirSync(dirname(localPath), { recursive: true })
    writeFileSync(localPath, 'audio')
    upsertLocalMediaAsset({
      neteaseSongId: song.id,
      filePath: localPath,
      provenance: 'download_task',
      ownership: 'managed',
      evidence: { audioOperation: 'downloaded' },
    })
    const oldTrack = {
      ratingKey: 'old-mb',
      title: song.name,
      grandparentTitle: song.artists[0]!.name,
      parentTitle: song.album.name,
      Media: [{ Part: [{ file: '/volume1/06_Music/legacy/old.flac' }] }],
    }
    const managedTrack = {
      ratingKey: 'managed-path',
      playlistItemID: 99,
      title: '[Wrong Plex title]',
      grandparentTitle: 'Various Artists',
      parentTitle: '[Unknown Album]',
      Media: [{ Part: [{ file: '/volume1/06_Music/黑豹乐队/黑豹 (1991)/08 - 无地自容.flac' }] }],
    }
    upsertSongIdentityBinding({
      neteaseSongId: song.id,
      plexSectionKey: '12',
      plexFilePath: oldTrack.Media[0]!.Part[0]!.file,
      plexSectionRoot: '/volume1/06_Music',
      plexRatingKey: oldTrack.ratingKey,
      mbRecordingId: 'old-recording',
      bindingMethod: 'mb_recording',
      status: 'active',
      evidence: { source: 'old_auto_match' },
    })
    getPlaylistTracks.mockResolvedValue([managedTrack])
    getTrackByRatingKey.mockResolvedValue(oldTrack)

    const { resolveTracks } = await import('./lookup')
    const result = await resolveTracks([song], 'playlist', '12', config(root!), false)

    expect(result.resolutions[0]).toMatchObject({
      resolution: 'matched_plex_playlist',
      plexRatingKey: managedTrack.ratingKey,
      playlistItemId: managedTrack.playlistItemID,
      matchTrace: {
        identity: { method: 'path' },
        evidence: expect.objectContaining({ ownership: 'managed' }),
      },
    })
    expect(getSongIdentityBinding(song.id)).toMatchObject({
      plexRatingKey: managedTrack.ratingKey,
      plexFilePath: managedTrack.Media[0]!.Part[0]!.file,
      bindingMethod: 'path',
    })
  })

  it('keeps an explicit human binding above a managed exact path', async () => {
    const localPath = join(root!, '黑豹乐队/黑豹 (1991)/08 - 无地自容.flac')
    mkdirSync(dirname(localPath), { recursive: true })
    writeFileSync(localPath, 'audio')
    upsertLocalMediaAsset({
      neteaseSongId: song.id,
      filePath: localPath,
      provenance: 'download_task',
      ownership: 'managed',
      evidence: { audioOperation: 'downloaded' },
    })
    const manualTrack = {
      ratingKey: 'manual-choice',
      playlistItemID: 100,
      title: 'User selected version',
      grandparentTitle: 'User artist',
      parentTitle: 'User album',
      Media: [{ Part: [{ file: '/volume1/06_Music/manual/choice.flac' }] }],
    }
    const managedTrack = {
      ratingKey: 'managed-path',
      playlistItemID: 99,
      title: song.name,
      grandparentTitle: song.artists[0]!.name,
      parentTitle: song.album.name,
      Media: [{ Part: [{ file: '/volume1/06_Music/黑豹乐队/黑豹 (1991)/08 - 无地自容.flac' }] }],
    }
    upsertSongIdentityBinding({
      neteaseSongId: song.id,
      plexSectionKey: '12',
      plexFilePath: manualTrack.Media[0]!.Part[0]!.file,
      plexSectionRoot: '/volume1/06_Music',
      plexRatingKey: manualTrack.ratingKey,
      mbRecordingId: null,
      bindingMethod: 'manual',
      status: 'active',
      evidence: { decision: 'manual_rebind' },
    })
    getPlaylistTracks.mockResolvedValue([managedTrack, manualTrack])
    getTrackByRatingKey.mockResolvedValue(manualTrack)

    const { resolveTracks } = await import('./lookup')
    const result = await resolveTracks([song], 'playlist', '12', config(root!), false)

    expect(result.resolutions[0]).toMatchObject({
      resolution: 'matched_plex_playlist',
      plexRatingKey: manualTrack.ratingKey,
      playlistItemId: manualTrack.playlistItemID,
      matchTrace: { identity: { method: 'manual' } },
    })
    expect(getSongIdentityBinding(song.id)).toMatchObject({
      plexRatingKey: manualTrack.ratingKey,
      bindingMethod: 'manual',
    })
  })

  it('does not recover a stale binding by path when multiple Plex identities own that path', async () => {
    const plexPath = '/volume1/06_Music/黑豹乐队/黑豹 (1991)/08 - 无地自容.flac'
    const duplicateA = {
      ratingKey: 'duplicate-binding-a',
      title: song.name,
      grandparentTitle: '错误刮削 A',
      parentTitle: song.album.name,
      Media: [{ Part: [{ file: plexPath }] }],
    }
    const duplicateB = {
      ratingKey: 'duplicate-binding-b',
      title: song.name,
      grandparentTitle: '错误刮削 B',
      parentTitle: song.album.name,
      Media: [{ Part: [{ file: plexPath }] }],
    }
    upsertSongIdentityBinding({
      neteaseSongId: song.id,
      plexSectionKey: '12',
      plexSectionRoot: '/volume1/06_Music',
      plexFilePath: plexPath,
      plexRatingKey: 'stale-rating-key',
      bindingMethod: 'manual',
      status: 'active',
      evidence: { decision: 'human' },
    })
    getPlaylistTracks.mockResolvedValue([])
    getTrackFilePathsByRatingKey.mockResolvedValue([plexPath])
    findTrackByFilePath.mockResolvedValue(duplicateA)
    findTracksByFilePath.mockResolvedValue([duplicateA, duplicateB])

    const { resolveTracks } = await import('./lookup')
    const result = await resolveTracks([song], '43411', '12', config(root!), false, { sourceId: 'source', runId: 'run' })

    expect(result.resolutions[0]).toMatchObject({
      resolution: 'needs_review',
      matchTrace: {
        decision: 'pending_review',
        evidence: { conflictingRatingKeys: ['duplicate-binding-a', 'duplicate-binding-b'] },
      },
    })
  })

  it('keeps a managed path under review when multiple Plex identities share it', async () => {
    const localPath = join(root!, '黑豹乐队/黑豹 (1991)/08 - 无地自容.flac')
    mkdirSync(dirname(localPath), { recursive: true })
    writeFileSync(localPath, 'audio')
    upsertLocalMediaAsset({
      neteaseSongId: song.id,
      filePath: localPath,
      provenance: 'download_task',
      ownership: 'managed',
      evidence: { audioOperation: 'downloaded' },
    })
    const sharedPlexPath = '/volume1/06_Music/黑豹乐队/黑豹 (1991)/08 - 无地自容.flac'
    getPlaylistTracks.mockResolvedValue([
      {
        ratingKey: 'duplicate-a',
        playlistItemID: 101,
        title: song.name,
        grandparentTitle: song.artists[0]!.name,
        parentTitle: song.album.name,
        Media: [{ Part: [{ file: sharedPlexPath }] }],
      },
      {
        ratingKey: 'duplicate-b',
        playlistItemID: 102,
        title: '[Wrong metadata]',
        grandparentTitle: 'Various Artists',
        parentTitle: '[Unknown Album]',
        Media: [{ Part: [{ file: sharedPlexPath }] }],
      },
    ])

    const { resolveTracks } = await import('./lookup')
    const result = await resolveTracks([song], 'playlist', '12', config(root!), false, {
      sourceId: 'source',
      runId: 'run',
    })

    expect(result.resolutions[0]).toMatchObject({
      resolution: 'needs_review',
      matchTrace: {
        source: 'pending_review',
        decision: 'pending_review',
        evidence: expect.objectContaining({
          localOwnership: 'managed',
          conflictingRatingKeys: ['duplicate-a', 'duplicate-b'],
        }),
      },
    })
    expect(getSongIdentityBinding(song.id)).toBeNull()
    expect(queryMatchReviews({ status: 'pending' }).items[0]).toMatchObject({
      candidatePlexFilePath: sharedPlexPath,
      candidatePlexRatingKey: null,
      evidenceType: 'path',
    })
  })

  it('does not treat a computed external path as unconditional song identity', async () => {
    const localPath = join(root!, '黑豹乐队/黑豹 (1991)/08 - 无地自容.flac')
    mkdirSync(dirname(localPath), { recursive: true })
    writeFileSync(localPath, 'audio')
    const candidate = {
      ratingKey: 'external-path',
      playlistItemID: 103,
      title: '[Wrong Plex title]',
      grandparentTitle: 'Various Artists',
      parentTitle: '[Unknown Album]',
      Media: [{ Part: [{ file: '/volume1/06_Music/黑豹乐队/黑豹 (1991)/08 - 无地自容.flac' }] }],
    }
    getPlaylistTracks.mockResolvedValue([candidate])
    getTrackByRatingKey.mockResolvedValue(candidate)

    const { resolveTracks } = await import('./lookup')
    const result = await resolveTracks([song], 'playlist', '12', config(root!), false, {
      sourceId: 'source',
      runId: 'run',
    })

    expect(result.resolutions[0]).toMatchObject({
      resolution: 'needs_review',
      matchTrace: {
        source: 'pending_review',
        candidate: { ratingKey: candidate.ratingKey },
        evidence: expect.objectContaining({
          localOwnership: 'external',
        }),
      },
    })
    expect(getSongIdentityBinding(song.id)).toBeNull()
  })

  it('does not trust a managed path after its file was replaced outside YunPlex', async () => {
    const localPath = join(root!, '黑豹乐队/黑豹 (1991)/08 - 无地自容.flac')
    mkdirSync(dirname(localPath), { recursive: true })
    writeFileSync(localPath, 'original')
    upsertLocalMediaAsset({
      neteaseSongId: song.id,
      filePath: localPath,
      provenance: 'download_task',
      ownership: 'managed',
      evidence: { audioOperation: 'downloaded' },
    })
    writeFileSync(localPath, 'replacement-audio')
    const candidate = {
      ratingKey: 'replaced-path',
      playlistItemID: 104,
      title: '[Wrong Plex title]',
      grandparentTitle: 'Various Artists',
      parentTitle: '[Unknown Album]',
      Media: [{ Part: [{ file: '/volume1/06_Music/黑豹乐队/黑豹 (1991)/08 - 无地自容.flac' }] }],
    }
    getPlaylistTracks.mockResolvedValue([candidate])
    getTrackByRatingKey.mockResolvedValue(candidate)

    const { resolveTracks } = await import('./lookup')
    const result = await resolveTracks([song], 'playlist', '12', config(root!), false)

    expect(result.resolutions[0]).toMatchObject({
      resolution: 'needs_review',
      matchTrace: {
        source: 'pending_review',
        evidence: expect.objectContaining({
          localOwnership: 'managed',
          localAssetStatus: 'replaced',
        }),
      },
    })
    expect(getSongIdentityBinding(song.id)).toBeNull()
  })

  it('binds a unique playlist media path when only extension case differs', async () => {
    const localPath = join(root!, 'Tank/Fighting!生存之道 (2006)/03 - 三国恋.mp3')
    mkdirSync(dirname(localPath), { recursive: true })
    writeFileSync(localPath, 'audio')
    const currentTrack = {
      ratingKey: '41351', playlistItemID: 5626, title: '三國戀 The Love of Three Kingdoms',
      grandparentTitle: 'Tank', parentTitle: 'Fighting! 生存之道',
      Media: [{ Part: [{ file: '/volume1/06_Music/Tank/Fighting!生存之道 (2006)/03 - 三国恋.MP3' }] }],
    }
    getPlaylistTracks.mockResolvedValue([currentTrack])
    const target: NeteaseSong = {
      id: 150361, name: '三国恋', no: 3, dt: 246173, disc: '1',
      artists: [{ id: 12485, name: 'Tank' }],
      album: { id: 15128, name: 'Fighting!生存之道', picUrl: '', publishTime: 1136073600000 },
    }
    upsertLocalMediaAsset({
      neteaseSongId: target.id,
      filePath: localPath,
      provenance: 'download_task',
      ownership: 'managed',
      evidence: { audioOperation: 'downloaded' },
    })

    const { resolveTracks } = await import('./lookup')
    const result = await resolveTracks([target], 'playlist', '12', config(root!), false)

    expect(result.resolutions[0]).toMatchObject({
      resolution: 'matched_plex_playlist', plexRatingKey: '41351', playlistItemId: 5626,
      matchTrace: { identity: { method: 'path' } },
    })
    expect(searchTrackCandidates).not.toHaveBeenCalled()
  })

  it('keeps a case-folded playlist path ambiguous when two physical identities collide', async () => {
    const localPath = join(root!, 'Tank/Fighting!生存之道 (2006)/03 - 三国恋.mp3')
    mkdirSync(dirname(localPath), { recursive: true })
    writeFileSync(localPath, Buffer.from('ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000'))
    const target: NeteaseSong = {
      id: 150361, name: '三国恋', no: 3, dt: 246173, disc: '1',
      artists: [{ id: 12485, name: 'Tank' }],
      album: { id: 15128, name: 'Fighting!生存之道', picUrl: '', publishTime: 1136073600000 },
    }
    getPlaylistTracks.mockResolvedValue([
      {
        ratingKey: 'upper', playlistItemID: 1, title: 'Unrelated A', grandparentTitle: 'Other', parentTitle: 'Other',
        Media: [{ Part: [{ file: '/VOLUME1/06_MUSIC/TANK/FIGHTING!生存之道 (2006)/03 - 三国恋.MP3' }] }],
      },
      {
        ratingKey: 'lower', playlistItemID: 2, title: 'Unrelated B', grandparentTitle: 'Other', parentTitle: 'Other',
        Media: [{ Part: [{ file: '/volume1/06_music/tank/fighting!生存之道 (2006)/03 - 三国恋.mp3' }] }],
      },
    ])

    const { resolveTracks } = await import('./lookup')
    const result = await resolveTracks([target], 'playlist', '12', config(root!), false)

    expect(result.resolutions[0]).toMatchObject({ resolution: 'found_on_disk' })
    expect(getSongIdentityBinding(target.id)).toBeNull()
  })

  it('automatically binds an exact typed NetEase provider identity before ambiguous MusicBrainz evidence', async () => {
    const candidate = {
      ratingKey: '35859', playlistItemID: 5627, title: '葡萄成熟时',
      grandparentTitle: 'Eason Chan', parentTitle: 'U87', index: 6, duration: 279846,
      guid: 'com.plexapp.agents.WangYiYun://2116/6491/-1/6?lang=zh',
      Media: [{ Part: [{ file: '/volume1/06_Music/陈奕迅/U87/葡萄成熟时.flac' }] }],
    }
    const target: NeteaseSong = {
      id: 66285, name: '葡萄成熟时', no: 6, dt: 279846, disc: '1',
      artists: [{ id: 2116, name: '陈奕迅' }],
      album: { id: 6491, name: 'U87', picUrl: '', publishTime: 0 },
    }
    getPlaylistTracks.mockResolvedValue([candidate])
    getTrackByRatingKey.mockResolvedValue(candidate)
    resolveSongArtistCandidateNames.mockResolvedValue(['陈奕迅', 'Eason Chan'])
    getPlexTrackNeteaseIdentity.mockReturnValue({
      provider: 'wangyiyun', artistId: 2116, albumId: 6491,
      discNumber: null, trackNumber: 6, rawGuid: candidate.guid,
    })
    resolveRecording.mockResolvedValue({ id: null, status: 'ambiguous' })
    const cfg = config(root!)
    cfg.other!.enableMusicBrainzResolver = true

    const { resolveTracks } = await import('./lookup')
    const result = await resolveTracks([target], 'playlist', '12', cfg, false)

    expect(result.resolutions[0]).toMatchObject({
      resolution: 'matched_plex_playlist', plexRatingKey: '35859', playlistItemId: 5627,
      matchTrace: { source: 'provider_identity', identity: { method: 'provider_guid' } },
    })
    expect(resolveRecording).not.toHaveBeenCalled()
    expect(queryMatchReviews({ status: 'pending' }).total).toBe(0)
  })

  it('does not auto-bind when multiple candidates have equal metadata strength', async () => {
    const target: NeteaseSong = {
      id: 7001, name: 'Same Song', no: 1, dt: 180000, disc: '1',
      artists: [{ id: 9, name: 'Same Artist' }],
      album: { id: 10, name: 'Same Album', picUrl: '', publishTime: 0 },
    }
    const candidates = ['rk-a', 'rk-b'].map((ratingKey, index) => ({
      ratingKey,
      playlistItemID: index + 1,
      title: target.name,
      grandparentTitle: target.artists[0]!.name,
      parentTitle: target.album.name,
      Media: [{ Part: [{ file: `/music/${ratingKey}.flac` }] }],
    }))
    getPlaylistTracks.mockResolvedValue(candidates)
    getTrackByRatingKey.mockImplementation(async ratingKey =>
      candidates.find(candidate => candidate.ratingKey === ratingKey) ?? null)
    getPlexTrackNeteaseIdentity.mockReturnValue({
      provider: 'wangyiyun', artistId: 9, albumId: 10,
      discNumber: 1, trackNumber: 1, rawGuid: 'provider://same',
    })

    const { resolveTracks } = await import('./lookup')
    const result = await resolveTracks([target], 'playlist', '12', config(root!), false)

    expect(result.resolutions[0]).toMatchObject({
      resolution: 'needs_review',
      matchTrace: { source: 'pending_review' },
    })
    expect(getSongIdentityBinding(target.id)).toBeNull()
  })

  it('finds an exact library path even when title search returns no candidates', async () => {
    const localPath = join(root!, '回春丹/耳鬼出风 (2021)/09 - 艾蜜莉.flac')
    mkdirSync(dirname(localPath), { recursive: true })
    writeFileSync(localPath, 'audio')
    const emily: NeteaseSong = {
      id: 1888390721,
      name: '艾蜜莉',
      no: 9,
      dt: 300549,
      disc: '1',
      artists: [{ name: '回春丹' }],
      album: { id: 135014271, name: '耳鬼出风', picUrl: '', publishTime: 1634832000000 },
    }
    const exactTrack = {
      ratingKey: 'rk-emily',
      title: '[Unknown]',
      grandparentTitle: 'Various Artists',
      parentTitle: '[Unknown Album]',
      Media: [{ Part: [{ file: '/volume1/06_Music/回春丹/耳鬼出风 (2021)/09 - 艾蜜莉.flac' }] }],
    }
    getPlaylistTracks.mockResolvedValue([])
    findTracksByFilePath.mockResolvedValue([exactTrack])
    upsertLocalMediaAsset({
      neteaseSongId: emily.id,
      filePath: localPath,
      provenance: 'download_task',
      ownership: 'managed',
      evidence: { audioOperation: 'downloaded' },
    })

    const { resolveTracks } = await import('./lookup')
    const result = await resolveTracks([emily], '43411', '12', config(root!), false)

    expect(findTracksByFilePath).toHaveBeenCalledWith('12', '/volume1/06_Music/回春丹/耳鬼出风 (2021)/09 - 艾蜜莉.flac')
    expect(result.resolutions[0]).toMatchObject({ resolution: 'found_in_plex_library', plexRatingKey: 'rk-emily' })
    expect(searchTrackCandidates).not.toHaveBeenCalled()
  })

  it('does not requeue a human-rejected Plex candidate and continues to the local file', async () => {
    const localPath = join(root!, '黑豹乐队/黑豹 (1991)/08 - 无地自容.flac')
    mkdirSync(dirname(localPath), { recursive: true })
    writeFileSync(localPath, Buffer.from('fLaC'))
    const rejectedTrack = {
      ratingKey: 'old-copy',
      playlistItemID: 5516,
      title: '无地自容',
      grandparentTitle: '黑豹乐队',
      parentTitle: '黑豹',
      Media: [{ Part: [{ file: '/volume1/06_Music/黑豹乐队/黑豹/08. 无地自容.flac' }] }],
    }
    const review = createMatchReview({
      neteaseSongId: song.id,
      candidatePlexFilePath: rejectedTrack.Media[0]!.Part[0]!.file,
      candidatePlexRatingKey: rejectedTrack.ratingKey,
    })
    decideMatchReview(review.id, 'reject')
    getPlaylistTracks.mockResolvedValue([rejectedTrack])
    getTrackByRatingKey.mockResolvedValue(rejectedTrack)

    const { resolveTracks } = await import('./lookup')
    const result = await resolveTracks([song], '43411', '12', config(root!), false)

    expect(result.resolutions[0]).toMatchObject({
      resolution: 'found_on_disk',
      filePath: localPath,
    })
    expect(queryMatchReviews({ status: 'pending' }).total).toBe(0)
  })

  it('downloads before checking an active automatic binding when the policy is enabled', async () => {
    getPlaylistTracks.mockResolvedValue([])
    upsertSongIdentityBinding({
      neteaseSongId: song.id,
      plexSectionKey: '12',
      plexFilePath: '/volume1/06_Music/old.flac',
      plexRatingKey: 'old-rating',
      mbRecordingId: null,
      bindingMethod: 'path',
      status: 'active',
      evidence: {},
    })

    const { resolveTracks } = await import('./lookup')
    const result = await resolveTracks(
      [song],
      'playlist',
      '12',
      config(root!),
      false,
      {},
      { downloadWhenMediaMissing: true },
    )

    expect(result.resolutions[0]).toMatchObject({
      resolution: 'needs_download',
      mediaPolicy: { disposition: 'download_missing' },
      matchTrace: {
        source: 'media_policy',
        evidence: {
          previousBindingPreservedUntilReplacement: true,
          previousRatingKey: 'old-rating',
        },
      },
    })
    expect(getSongIdentityBinding(song.id)).toMatchObject({ status: 'active', plexRatingKey: 'old-rating' })
    expect(getTrackByRatingKey).not.toHaveBeenCalled()
    expect(searchTrackCandidates).not.toHaveBeenCalled()
    expect(resolveRecording).not.toHaveBeenCalled()
  })

  it('keeps an unavailable manual binding exempt from automatic download', async () => {
    getPlaylistTracks.mockResolvedValue([])
    upsertSongIdentityBinding({
      neteaseSongId: song.id,
      plexSectionKey: '12',
      plexFilePath: '/volume1/06_Music/manual.flac',
      plexRatingKey: 'manual-rating',
      mbRecordingId: null,
      bindingMethod: 'manual',
      status: 'active',
      evidence: {},
    })

    const { resolveTracks } = await import('./lookup')
    const result = await resolveTracks(
      [song],
      'playlist',
      '12',
      config(root!),
      false,
      {},
      { downloadWhenMediaMissing: true },
    )

    expect(result.resolutions[0]).toMatchObject({
      resolution: 'needs_review',
      mediaPolicy: { disposition: 'manual_exempt' },
    })
    expect(getSongIdentityBinding(song.id)).toMatchObject({ status: 'active', bindingMethod: 'manual' })
    expect(searchTrackCandidates).not.toHaveBeenCalled()
  })

  it('does not register a discovered file during preview', async () => {
    getPlaylistTracks.mockResolvedValue([])
    const localPath = join(root!, '黑豹乐队/黑豹 (1991)/08 - 无地自容.flac')
    mkdirSync(dirname(localPath), { recursive: true })
    writeFileSync(localPath, 'fLaC')

    const { resolveTracks } = await import('./lookup')
    const result = await resolveTracks(
      [song],
      'playlist',
      '12',
      config(root!),
      true,
      {},
      { downloadWhenMediaMissing: true },
    )

    expect(result.resolutions[0]?.mediaPolicy?.disposition).toBe('register_external')
    expect((getDb().prepare(`
      SELECT COUNT(*) AS count FROM local_media_assets WHERE netease_song_id = ?
    `).get(song.id) as { count: number }).count).toBe(0)
  })
})
