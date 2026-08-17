import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, initDb } from '../db'
import type { AppConfig } from '../config/types'
import type { NeteaseSong } from '../netease'
import {
  createMatchReview,
  getSongIdentityBinding,
  queryMatchReviews,
} from './identity-store'

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

describe('MusicBrainz track identity lookup', () => {
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

  it('automatically binds a Plex release-track MBID after mapping it to the desired recording', async () => {
    const releaseTrackId = '8220c472-146e-4a9e-a71e-fd8beb603e14'
    const recordingId = '1cdb1f16-31e5-4765-af6e-c3c02386dcc4'
    const legacyTrack = {
      ratingKey: 'easy-plex',
      playlistItemID: 777,
      title: 'Easy Come Easy Go',
      grandparentTitle: '蔡健雅',
      parentTitle: '失语者',
      Guid: [{ id: `mbid://${releaseTrackId}` }],
      Media: [{ Part: [{ file: '/volume1/06_Music/蔡健雅/失语者/05. Easy Come Easy Go.flac' }] }],
    }
    const easyComeEasyGo: NeteaseSong = {
      id: 27747326,
      name: 'Easy Come Easy Go',
      no: 5,
      dt: 240000,
      disc: '1',
      artists: [{ name: '蔡健雅' }, { name: 'MC HotDog 热狗' }],
      album: { id: 1, name: '失语者', picUrl: '', publishTime: 1451577600000 },
    }
    getPlaylistTracks.mockResolvedValue([legacyTrack])
    getTrackByRatingKey.mockResolvedValue(legacyTrack)
    resolveSongArtistCandidateNames.mockResolvedValue(['蔡健雅', 'MC HotDog 热狗'])
    getPlexTrackMusicBrainzIdentity.mockReturnValue({
      explicitRecordingId: null,
      untypedIds: [releaseTrackId],
      rawGuids: [`mbid://${releaseTrackId}`],
    })
    resolveRecording.mockResolvedValue({ id: recordingId, status: 'success' })
    resolveMusicBrainzIdToRecording.mockResolvedValue({
      inputId: releaseTrackId,
      recordingId,
      entityType: 'release_track',
      status: 'success',
      candidateRecordingIds: [recordingId],
      failureReason: null,
      cacheHit: false,
    })
    const cfg = config(root!)
    cfg.other!.enableMusicBrainzResolver = true

    const { resolveTracks } = await import('./lookup')
    const result = await resolveTracks([easyComeEasyGo], 'playlist', '12', cfg, false, { sourceId: 'source', runId: 'run' })

    expect(result.resolutions[0]).toMatchObject({
      resolution: 'matched_plex_playlist',
      plexRatingKey: 'easy-plex',
      playlistItemId: 777,
      matchTrace: { identity: { method: 'mb_recording', mbRecordingId: recordingId } },
    })
    expect(resolveMusicBrainzIdToRecording).toHaveBeenCalledWith(releaseTrackId)
    expect(queryMatchReviews({ status: 'pending' }).total).toBe(0)
  })

  it('passes duration evidence through both MB lookups and keeps Plex display credits from skewing identity', async () => {
    const recordingId = '4c34a9be-b6c3-4c79-8a5d-dcad96ba2ee9'
    const target: NeteaseSong = {
      id: 1907766514,
      name: '11',
      no: 1,
      dt: 234817,
      disc: '1',
      artists: [{ name: '队长' }, { name: '黄礼格' }],
      album: { id: 1, name: '11', picUrl: '', publishTime: 1640995200000 },
    }
    const candidate = {
      ratingKey: '36538',
      playlistItemID: 800,
      title: '11',
      grandparentTitle: '队长&黄礼格',
      parentTitle: '11',
      index: 1,
      duration: 234817,
      Guid: [{ id: 'local://36538' }],
      Media: [{ Part: [{ file: '/volume1/06_Music/队长&黄礼格/11/11.flac' }] }],
    }
    getPlaylistTracks.mockResolvedValue([candidate])
    getTrackByRatingKey.mockResolvedValue(candidate)
    resolveSongArtistCandidateNames.mockResolvedValue(['队长', '黄礼格'])
    getPlexTrackMusicBrainzIdentity.mockReturnValue({
      explicitRecordingId: null,
      untypedIds: [],
      rawGuids: ['local://36538'],
    })
    const previousReview = createMatchReview({
      neteaseSongId: target.id,
      sourceId: 'source',
      runId: 'previous-run',
      candidatePlexFilePath: candidate.Media[0]!.Part[0]!.file,
      candidatePlexRatingKey: candidate.ratingKey,
      evidence: { reason: 'previously ambiguous' },
    })
    resolveRecording.mockResolvedValue({ id: recordingId, status: 'success' })
    const cfg = config(root!)
    cfg.other!.enableMusicBrainzResolver = true

    const { resolveTracks } = await import('./lookup')
    const result = await resolveTracks([target], 'playlist', '12', cfg, false, { sourceId: 'source', runId: 'run' })

    expect(resolveRecording).toHaveBeenNthCalledWith(1, '11', ['队长', '黄礼格'], '11', {
      durationMs: 234817,
      durationToleranceMs: 2000,
    })
    expect(resolveRecording).toHaveBeenNthCalledWith(2, '11', ['队长', '黄礼格'], '11', {
      durationMs: 234817,
      durationToleranceMs: 2000,
    })
    expect(result.resolutions[0]).toMatchObject({
      resolution: 'matched_plex_playlist',
      plexRatingKey: '36538',
      playlistItemId: 800,
      matchTrace: {
        source: 'mb_recording_migration',
        identity: { method: 'mb_recording', mbRecordingId: recordingId },
      },
    })
    expect(queryMatchReviews({ status: 'pending' }).total).toBe(0)
    expect(queryMatchReviews({ status: 'superseded' }).items[0]).toMatchObject({
      id: previousReview.id,
      decision: 'resolved_by_mb_recording',
    })
    expect(getSongIdentityBinding(target.id)?.evidence).toMatchObject({
      source: 'musicbrainz_recording',
      desiredRecordingId: recordingId,
      candidateRecordingId: recordingId,
      desiredRecordingEvidence: { id: recordingId, status: 'success' },
      candidateRecordingEvidence: { id: recordingId, status: 'success' },
    })
  })

  it('keeps a generic Plex MBID review-only when its entity mapping fails', async () => {
    const genericId = '8220c472-146e-4a9e-a71e-fd8beb603e14'
    const recordingId = '1cdb1f16-31e5-4765-af6e-c3c02386dcc4'
    const candidate = {
      ratingKey: 'failed-map', playlistItemID: 778, title: song.name,
      grandparentTitle: song.artists[0]!.name, parentTitle: song.album.name,
      Guid: [{ id: `mbid://${genericId}` }],
      Media: [{ Part: [{ file: '/volume1/06_Music/legacy/08. 无地自容.flac' }] }],
    }
    getPlaylistTracks.mockResolvedValue([candidate])
    getTrackByRatingKey.mockResolvedValue(candidate)
    getPlexTrackMusicBrainzIdentity.mockReturnValue({
      explicitRecordingId: null, untypedIds: [genericId], rawGuids: [`mbid://${genericId}`],
    })
    resolveRecording.mockResolvedValue({ id: recordingId, status: 'success' })
    resolveMusicBrainzIdToRecording.mockResolvedValue({
      inputId: genericId, recordingId: null, entityType: 'unknown', status: 'failed',
      candidateRecordingIds: [], failureReason: 'network_error', cacheHit: false,
    })
    const cfg = config(root!)
    cfg.other!.enableMusicBrainzResolver = true

    const { resolveTracks } = await import('./lookup')
    const result = await resolveTracks([song], 'playlist', '12', cfg, false)

    expect(result.resolutions[0]).toMatchObject({ resolution: 'needs_review' })
    // A failed typed-ID lookup must not be hidden by a looser metadata lookup.
    expect(resolveRecording).toHaveBeenCalledTimes(1)
    expect(queryMatchReviews({ status: 'pending' }).items[0]?.candidateMbRecordingId).toBeNull()
  })

  it('keeps all-field metadata as review evidence when MB identity is unavailable', async () => {
    const candidate = {
      ratingKey: 'you-will-be-alright',
      playlistItemID: 779,
      title: "You'll Be Alright",
      grandparentTitle: 'Elope/王奇歆',
      parentTitle: "You'll Be Alright",
      index: 1,
      duration: 194647,
      Media: [{ Part: [{ file: "/volume1/06_Music/Elope&王奇歆/You'll Be Alright/01 - You'll Be Alright.flac" }] }],
    }
    const target: NeteaseSong = {
      id: 540651004,
      name: "You'll Be Alright",
      no: 1,
      dt: 194000,
      disc: '1',
      artists: [{ name: 'Elope' }, { name: '王奇歆' }],
      album: { id: 1, name: "You'll Be Alright", picUrl: '', publishTime: 1514764800000 },
    }
    getPlaylistTracks.mockResolvedValue([candidate])
    getTrackByRatingKey.mockResolvedValue(candidate)
    resolveSongArtistCandidateNames.mockResolvedValue(['Elope', '王奇歆'])
    getPlexTrackMusicBrainzIdentity.mockReturnValue({ explicitRecordingId: null, untypedIds: [], rawGuids: ['local://1'] })
    resolveRecording.mockResolvedValue({ id: null, status: 'empty' })
    const cfg = config(root!)
    cfg.other!.enableMusicBrainzResolver = true

    const { resolveTracks } = await import('./lookup')
    const result = await resolveTracks([target], 'playlist', '12', cfg, false)

    expect(result.resolutions[0]).toMatchObject({
      resolution: 'needs_review',
      matchTrace: { source: 'pending_review' },
    })
    expect(queryMatchReviews({ status: 'pending' }).total).toBe(1)
  })

  it('keeps concordant MB ambiguity as review-only evidence', async () => {
    const target: NeteaseSong = {
      id: 461544624,
      name: 'Selfish',
      no: 15,
      dt: 251472,
      disc: '1',
      artists: [{ name: 'Future' }, { name: 'Rihanna' }],
      album: { id: 1, name: 'HNDRXX', picUrl: '', publishTime: 0 },
    }
    const candidate = {
      ratingKey: '15570',
      playlistItemID: 900,
      title: 'Selfish (feat. Rihanna)',
      grandparentTitle: 'Future',
      parentTitle: 'HNDRXX',
      index: 15,
      duration: 251422,
      Media: [{ Part: [{ file: '/volume1/06_Music/Future/HNDRXX/15. Future - Selfish (feat. Rihanna).flac' }] }],
    }
    const recordingCandidates = [
      { id: '750f', score: 100, title: 'Selfish', artist: 'Future feat. Rihanna', lengthMs: 251000, durationDeltaMs: 472, titleDescriptorCompatible: true },
      { id: 'ae93', score: 100, title: 'Selfish', artist: 'Future feat. Rihanna', lengthMs: 251000, durationDeltaMs: 472, titleDescriptorCompatible: true },
    ]
    getPlaylistTracks.mockResolvedValue([candidate])
    getTrackByRatingKey.mockResolvedValue(candidate)
    resolveSongArtistCandidateNames.mockResolvedValue(['Future', 'Rihanna'])
    resolveRecording
      .mockResolvedValueOnce({ id: null, status: 'ambiguous', candidates: recordingCandidates })
      .mockResolvedValueOnce({
        id: null,
        status: 'ambiguous',
        candidates: recordingCandidates.map(item => ({ ...item, durationDeltaMs: 422 })),
      })
    const cfg = config(root!)
    cfg.other!.enableMusicBrainzResolver = true

    const { resolveTracks } = await import('./lookup')
    const result = await resolveTracks([target], 'playlist', '12', cfg, false)

    expect(result.resolutions[0]).toMatchObject({
      resolution: 'needs_review',
      matchTrace: { source: 'pending_review' },
    })
    expect(queryMatchReviews({ status: 'pending' }).total).toBe(1)
  })

  it('keeps a mapped candidate in review when the target recording remains ambiguous', async () => {
    const releaseTrackId = 'ccd11b0b-42f2-4b75-93d8-25acde23fcec'
    const recordingId = '017cb61b-b382-479a-bfff-918619b25678'
    const target: NeteaseSong = {
      id: 439076364,
      name: 'Solo Dance',
      no: 1,
      dt: 173240,
      disc: '1',
      artists: [{ name: 'Martin Jensen' }],
      album: { id: 1, name: 'Solo Dance', picUrl: '', publishTime: 0 },
    }
    const candidate = {
      ratingKey: '7629',
      playlistItemID: 901,
      title: 'Solo Dance',
      grandparentTitle: 'Martin Jensen',
      parentTitle: 'Solo Dance',
      index: 1,
      duration: 173240,
      Media: [{ Part: [{ file: '/volume1/06_Music/Martin Jensen/Solo Dance/Solo Dance.flac' }] }],
    }
    getPlaylistTracks.mockResolvedValue([candidate])
    getTrackByRatingKey.mockResolvedValue(candidate)
    resolveSongArtistCandidateNames.mockResolvedValue(['Martin Jensen'])
    getPlexTrackMusicBrainzIdentity.mockReturnValue({
      explicitRecordingId: null,
      untypedIds: [releaseTrackId],
      rawGuids: [`mbid://${releaseTrackId}`],
    })
    resolveRecording.mockResolvedValue({
      id: null,
      status: 'ambiguous',
      candidates: [
        { id: 'remix', score: 94, title: 'Solo Dance (Remix)', artist: 'Martin Jensen', lengthMs: 173000, durationDeltaMs: 240, titleDescriptorCompatible: false },
        { id: recordingId, score: 82, title: 'Solo Dance', artist: 'Martin Jensen', lengthMs: 175180, durationDeltaMs: 1940, titleDescriptorCompatible: true },
      ],
    })
    resolveMusicBrainzIdToRecording.mockResolvedValue({
      inputId: releaseTrackId,
      recordingId,
      entityType: 'release_track',
      status: 'success',
      candidateRecordingIds: [recordingId],
      failureReason: null,
      cacheHit: false,
    })
    const cfg = config(root!)
    cfg.other!.enableMusicBrainzResolver = true

    const { resolveTracks } = await import('./lookup')
    const result = await resolveTracks([target], 'playlist', '12', cfg, false)

    expect(result.resolutions[0]).toMatchObject({
      resolution: 'needs_review',
      matchTrace: { source: 'pending_review' },
    })
    expect(queryMatchReviews({ status: 'pending' }).total).toBe(1)
  })

})
