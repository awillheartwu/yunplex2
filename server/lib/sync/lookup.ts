import { getDb } from '../db'
import type { AppConfig } from '../config/types'
import {
  searchTrack, getPlaylistTracks, getTrackByRatingKey, getTrackFilePathsByRatingKey,
  findTracksByFilePath, getPlexTrackMusicBrainzIdentity, getPlexTrackNeteaseIdentity,
  getPlexTrackRecordingId, type PlexTrack,
} from '../plex-client'
import type { NeteaseSong } from '../netease'
import type { MatchTrace, TrackResolution, SongLookupRow } from './types'
import { isArtistNameMatch, anyCandidateMatches, normalizeArtistName } from './artist-match'
import type { ArtistCandidate } from './artist-resolver'
import { clearSongLookupFilePath, deleteSongLookup, getSongLookup } from './song-lookup-store'
import { mapLocalPathToPlex, resolveAccessibleLocalPath } from './path-map'
import { resolveSongArtistCandidateNames } from './song-artist-candidates'
import { titleIdentityDescriptorsCompatible } from './matchers'
import { findExistingLocalSongPath } from './local-file-discovery'
import { resolveLocalMediaAsset } from './local-media-store'
import { validateLocalAudioFile } from '../media-validation'
import {
  createMatchReview, findRejectedMatchReview, getSongIdentityBinding, markSongIdentityBindingStale, normalizePlexPath,
  upsertVerifiedSongIdentityBinding,
} from './identity-store'
import { resolveMusicBrainzIdToRecording, resolveRecording } from '../integrations/musicbrainz'
import { resolvePlexIdentityPath } from './identity-normalization'
import { evaluateHighConfidenceMetadataMatch } from './high-confidence-metadata'
import { evaluateNeteaseProviderIdentity } from './provider-identity'
import { evaluateMetadataBindingMusicBrainzEvidence } from './metadata-binding-policy'

type IdentityContext = { sourceId?: string; runId?: string }

export interface ExtraTrack {
  playlistItemId: number
  ratingKey: string
  title: string
  artist: string
  album: string
  plexFilePaths: string[]
  mbRecordingId: string | null
  relatedNeteaseSongId?: number
  relatedReviewId?: string
  protectionReason?: string
}

/**
 * Build a TrackResolution for each song in the Netease playlist.
 *
 * Lookup chain:
 *   DB cache → verify in Plex → searchTrack (with MB aliases) → disk exists → download/unavailable
 */
export async function resolveTracks(
  yunSongs: NeteaseSong[],
  plexPlaylistRatingKey: string,
  sectionKey: string,
  cfg: AppConfig,
  dryRun = false,
  identityContext: IdentityContext = {},
): Promise<{ resolutions: TrackResolution[]; extraTracks: ExtraTrack[] }> {
  const db = getDb()
  const plexPlaylistTracks = plexPlaylistRatingKey
    ? await getPlaylistTracks(plexPlaylistRatingKey, 99999)
    : []

  const resolutions: TrackResolution[] = []
  const usedPlexKeys = new Set<string>()
  const claimedBindings = new Map<string, TrackResolution>()

  for (let i = 0; i < yunSongs.length; i++) {
    const song = yunSongs[i]!
    const resolution = await resolveOne(song, i, plexPlaylistTracks, sectionKey, cfg, db, dryRun, identityContext)
    const dedupedResolution = dedupeResolutionBinding(resolution, claimedBindings)
    if (dedupedResolution !== resolution && !dryRun) {
      deleteSongLookup(song.id)
    }
    resolutions.push(dedupedResolution)
    if (dedupedResolution.plexRatingKey) usedPlexKeys.add(dedupedResolution.plexRatingKey)
  }

  // Extra tracks: in Plex playlist but not matched to any Netease song
  const extraTracks: ExtraTrack[] = []
  for (const pt of plexPlaylistTracks) {
    if (pt.playlistItemID && !usedPlexKeys.has(pt.ratingKey)) {
      const candidateResolution = resolutions.find(resolution => resolution.matchTrace?.candidate?.ratingKey === pt.ratingKey)
      extraTracks.push({
        playlistItemId: pt.playlistItemID,
        ratingKey: pt.ratingKey,
        title: pt.title,
        artist: pt.grandparentTitle || '',
        album: pt.parentTitle || '',
        plexFilePaths: trackPaths(pt).map(normalizePlexPath),
        mbRecordingId: getPlexTrackRecordingId(pt),
        relatedNeteaseSongId: candidateResolution?.song.id,
        relatedReviewId: candidateResolution?.matchTrace?.candidate?.reviewId,
        protectionReason: candidateResolution?.matchTrace?.deletionProtectionReason
          ?? '尚未通过逐项强身份删除门禁',
      })
    }
  }

  return { resolutions, extraTracks }
}

async function resolveOne(
  song: NeteaseSong,
  index: number,
  plexTracks: PlexTrack[],
  sectionKey: string,
  cfg: AppConfig,
  db: ReturnType<typeof getDb>,
  dryRun: boolean,
  identityContext: IdentityContext,
): Promise<TrackResolution> {
  const base: Omit<TrackResolution, 'resolution'> = { neteaseIndex: index, song }
  const localAsset = resolveLocalMediaAsset(song, cfg)
  const expectedLocalPath = localAsset?.filePath ?? findExistingLocalSongPath(song, cfg)
  const expectedPlexPath = mapLocalPathToPlex(expectedLocalPath, cfg)
  const managedLocalIdentity = localAsset?.ownership === 'managed' && localAsset.status === 'active'

  // ── Step 0: durable identity binding ────────────────────────────────
  // Binding is intentionally checked before Plex metadata. Plex's agent can
  // rewrite artist/album fields, but it must never turn the same media file
  // into an "extra" track.
  const bound = getSongIdentityBinding(song.id)
  if (
    bound?.status === 'active'
    && (bound.bindingMethod === 'manual' || !managedLocalIdentity)
  ) {
    const currentBoundPlexPath = resolvePlexIdentityPath({
      relativePath: bound.plexRelativePath,
      currentSectionRoot: cfg.download.plexLibraryPathPrefix,
      lastObservedPath: bound.plexFilePath,
    })
    let boundTrack = bound.plexRatingKey ? await quickVerify(bound.plexRatingKey) : null
    let boundTrackPath = matchingTrackPath(boundTrack, currentBoundPlexPath)
    if (!boundTrack || !boundTrackPath) {
      const recoveredMatches = uniqueTrackPathMatches(
        (await findTracksByFilePath(sectionKey, currentBoundPlexPath)).flatMap((track) => {
          const path = matchingTrackPath(track, currentBoundPlexPath)
          return path ? [{ track, path }] : []
        }),
      )
      if (recoveredMatches.length > 1) {
        if (!dryRun) markSongIdentityBindingStale(song.id, {
          reason: 'bound_path_ambiguous',
          plexFilePath: currentBoundPlexPath,
          conflictingRatingKeys: recoveredMatches.map(match => match.track.ratingKey),
        })
        return ambiguousPathResolution({
          base,
          song,
          expectedLocalPath,
          plexPath: currentBoundPlexPath,
          ownership: localAsset?.ownership ?? 'external',
          provenance: localAsset?.provenance ?? 'computed',
          identityContext,
          dryRun,
          matches: recoveredMatches,
        })
      }
      boundTrack = recoveredMatches[0]?.track ?? null
      boundTrackPath = recoveredMatches[0]?.path ?? null
    }
    if (boundTrack && boundTrackPath) {
      const accessiblePath = resolveAccessibleLocalPath(boundTrackPath, cfg)
      if (!dryRun) {
        upsertVerifiedSongIdentityBinding({
          neteaseSongId: bound.neteaseSongId,
          plexSectionKey: bound.plexSectionKey,
          plexFilePath: boundTrackPath,
          plexRatingKey: boundTrack.ratingKey,
          mbRecordingId: bound.mbRecordingId,
          bindingMethod: bound.bindingMethod,
          status: 'active',
          evidence: { ...bound.evidence, verifiedBy: 'plex_file_path' },
        })
        upsertLookup(db, song.id, boundTrack.ratingKey, accessiblePath)
      }
      const playlistItem = plexTracks.find(track => track.ratingKey === boundTrack!.ratingKey)?.playlistItemID
      return {
        ...base, resolution: playlistItem ? 'matched_plex_playlist' : 'found_in_plex_library',
        plexRatingKey: boundTrack.ratingKey, playlistItemId: playlistItem, filePath: accessiblePath ?? undefined,
        matchTrace: buildMatchTrace('identity_binding', {
          ratingKey: boundTrack.ratingKey, filePath: accessiblePath ?? undefined, decision: 'bound',
          identity: { method: bound.bindingMethod, plexFilePath: normalizePlexPath(boundTrackPath), mbRecordingId: bound.mbRecordingId, bindingStatus: 'active' },
        }),
      }
    }
    if (!dryRun) markSongIdentityBindingStale(song.id, { reason: 'bound_path_not_found', plexFilePath: currentBoundPlexPath })
  }

  // ── Step 1: exact media path ───────────────────────────────────────
  // A YunPlex-managed path is stronger than every automatic identity. Plex
  // agents may rewrite all display metadata without changing the media file.
  // Explicit human bindings remain above this rule.
  if (expectedPlexPath) {
    const playlistPathMatches = findTrackPathMatches(plexTracks, expectedPlexPath)
    const libraryPathMatches = playlistPathMatches.length === 0
      ? (await findTracksByFilePath(sectionKey, expectedPlexPath)).flatMap((track) => {
          const path = matchingTrackPath(track, expectedPlexPath)
          return path ? [{ track, path }] : []
        })
      : []
    const pathMatches = uniqueTrackPathMatches(
      playlistPathMatches.length > 0 ? playlistPathMatches : libraryPathMatches,
    )
    if (pathMatches.length > 1) {
      return ambiguousPathResolution({
        base,
        song,
        expectedLocalPath,
        plexPath: expectedPlexPath,
        ownership: localAsset?.ownership ?? 'external',
        provenance: localAsset?.provenance ?? 'computed',
        identityContext,
        dryRun,
        matches: pathMatches,
      })
    }
    const playlistPathMatch = playlistPathMatches[0]
    const inPlaylistByPath = playlistPathMatch?.track
    const exactTrack = pathMatches[0]?.track
    const exactTrackPath = pathMatches[0]?.path
    if (exactTrack && exactTrackPath) {
      if (!managedLocalIdentity) {
        const reviewResolution = await pendingReview(
          base,
          song,
          exactTrack,
          sectionKey,
          cfg,
          identityContext,
          dryRun,
          '外部文件仅按计算路径命中，仍需来源身份、MusicBrainz recording 或人工确认',
          {
            localOwnership: localAsset?.ownership ?? 'external',
            localAssetStatus: localAsset?.status ?? null,
            localProvenance: localAsset?.provenance ?? 'computed',
            pathExact: true,
          },
        )
        if (reviewResolution) return reviewResolution
      }
      if (managedLocalIdentity) {
        const playlistItem = inPlaylistByPath?.playlistItemID
          ?? plexTracks.find(track => track.ratingKey === exactTrack.ratingKey)?.playlistItemID
        if (!dryRun) {
          bindPath(song.id, sectionKey, exactTrack.ratingKey, exactTrackPath, undefined, 'path', {
            source: inPlaylistByPath ? 'managed_playlist_exact_path' : 'managed_library_exact_path',
            ownership: 'managed',
            localProvenance: localAsset?.provenance ?? 'download_task',
            sourceTaskId: localAsset?.sourceTaskId ?? null,
          }, db, expectedLocalPath)
        }
        return {
          ...base,
          resolution: playlistItem ? 'matched_plex_playlist' : 'found_in_plex_library',
          plexRatingKey: exactTrack.ratingKey,
          playlistItemId: playlistItem,
          filePath: expectedLocalPath ?? undefined,
          matchTrace: buildMatchTrace('identity_binding', {
            ratingKey: exactTrack.ratingKey,
            filePath: expectedLocalPath ?? undefined,
            titleMatched: fuzzyMatchTitle(exactTrack.title, song.name),
            artistMatched: false,
            albumMatched: false,
            decision: 'bound',
            evidence: {
              ownership: 'managed',
              localProvenance: localAsset?.provenance ?? 'download_task',
              sourceTaskId: localAsset?.sourceTaskId ?? null,
            },
            identity: { method: 'path', plexFilePath: normalizePlexPath(exactTrackPath), bindingStatus: 'active' },
          }),
        }
      }
    }
  }

  // Managed media never falls through to Plex metadata. If Plex has not
  // indexed the owned path yet, keep the file as the target and let the scan /
  // retry phase recover its ratingKey.
  if (managedLocalIdentity && expectedLocalPath) {
    if (bound?.status === 'active' && bound.bindingMethod !== 'manual' && !dryRun) {
      markSongIdentityBindingStale(song.id, {
        reason: 'managed_path_not_indexed',
        managedLocalPath: expectedLocalPath,
        expectedPlexPath,
      })
    }
    const validation = validateLocalAudioFile(expectedLocalPath)
    if (!validation.valid) {
      return {
        ...base,
        resolution: 'needs_download',
        matchTrace: buildMatchTrace('invalid_local_file', {
          filePath: expectedLocalPath,
          message: validation.reason || 'YunPlex 托管音频文件无效，将重新下载',
          evidence: { ownership: 'managed', localProvenance: localAsset?.provenance },
        }),
      }
    }
    if (!dryRun) upsertLookup(db, song.id, null, expectedLocalPath)
    return {
      ...base,
      resolution: 'found_on_disk',
      filePath: expectedLocalPath,
      matchTrace: buildMatchTrace('disk', {
        filePath: expectedLocalPath,
        message: 'YunPlex 托管文件等待 Plex 按精确路径完成索引',
        evidence: {
          ownership: 'managed',
          localProvenance: localAsset?.provenance,
          sourceTaskId: localAsset?.sourceTaskId ?? null,
          expectedPlexPath,
        },
      }),
    }
  }

  // ── Resolve all artist candidates once for this song ──
  const artistCandidateNames = await resolveSongArtistCandidateNames(song.artists)
  const artistCandidates = artistCandidateNames.map((name) => ({
    name,
    normalizedName: normalizeArtistName(name),
    source: 'original' as const,
    confidence: 100,
  }))

  // ── Step 2: Check if already in Plex playlist ──
  const inPlaylist = plexTracks.find((pt) =>
    fuzzyMatchTitle(pt.title, song.name) &&
    anyCandidateMatches(pt.grandparentTitle, artistCandidates) &&
    fuzzyMatchAlbum(pt.parentTitle, song.album.name),
  )
  if (inPlaylist && inPlaylist.playlistItemID) {
    const identity = await getTrackPaths(inPlaylist.ratingKey, cfg, expectedLocalPath)
    if (identity.plexPath && identity.localPath && expectedLocalPath && samePath(identity.localPath, expectedLocalPath)) {
      if (!dryRun) bindPath(song.id, sectionKey, inPlaylist.ratingKey, identity.plexPath, undefined, 'path', { source: 'playlist_exact_path' }, db, identity.localPath)
      return {
        ...base, resolution: 'matched_plex_playlist', plexRatingKey: inPlaylist.ratingKey,
        playlistItemId: inPlaylist.playlistItemID, filePath: identity.localPath,
        matchTrace: buildMatchTrace('playlist', { ratingKey: inPlaylist.ratingKey, filePath: identity.localPath,
          titleMatched: true, artistMatched: true, albumMatched: true, decision: 'bound',
          identity: { method: 'path', plexFilePath: normalizePlexPath(identity.plexPath), bindingStatus: 'active' }, }),
      }
    }
    const reviewResolution = await pendingReview(base, song, inPlaylist, sectionKey, cfg, identityContext, dryRun,
      'Plex 歌单候选的文件路径未能与本地目标精确对应，已保留旧条目等待审核')
    if (reviewResolution) return reviewResolution
  }

  // ── Step 3: Check DB cache ──
  const cached = getSongLookup(song.id) as SongLookupRow | undefined
  if (cached?.plex_rating_key) {
    const verifiedTrack = await quickVerify(cached.plex_rating_key)
    const plexPath = trackPath(verifiedTrack)
    const filePath = plexPath ? resolveAccessibleLocalPath(plexPath, cfg) : null
    // Legacy cache can become a durable binding only after a live exact-path
    // validation. Never use its old title/artist snapshot as identity.
    if (verifiedTrack && plexPath && filePath && cached.file_path && samePath(filePath, cached.file_path)) {
      if (!dryRun) bindPath(song.id, sectionKey, cached.plex_rating_key, plexPath, undefined, 'migrated', { source: 'legacy_lookup_live_path' }, db, filePath)
      return {
        ...base,
        resolution: 'found_in_plex_library',
        plexRatingKey: cached.plex_rating_key,
        filePath: filePath ?? undefined,
        matchTrace: buildMatchTrace('legacy_binding_migrated', {
          ratingKey: cached.plex_rating_key,
          filePath: filePath ?? undefined,
          cacheVerified: true, decision: 'bound',
          identity: { method: 'migrated', plexFilePath: normalizePlexPath(plexPath), bindingStatus: 'active' },
        }),
      }
    }
    if (!dryRun) deleteSongLookup(song.id)
  }

  // ── Step 4: Search Plex library (now with resolved artist candidates) ──
  const found = await searchTrack(sectionKey, song.name, artistCandidateNames, song.album.name)
  if (found) {
    const identity = await getTrackPaths(found.ratingKey, cfg, expectedLocalPath)
    if (identity.plexPath && identity.localPath && expectedLocalPath && samePath(identity.localPath, expectedLocalPath)) {
      if (!dryRun) bindPath(song.id, sectionKey, found.ratingKey, identity.plexPath, undefined, 'path', { source: 'plex_search_exact_path' }, db, identity.localPath)
      return {
        ...base, resolution: 'found_in_plex_library', plexRatingKey: found.ratingKey, filePath: identity.localPath,
        matchTrace: buildMatchTrace('plex_search', { ratingKey: found.ratingKey, filePath: identity.localPath,
          titleMatched: true, artistMatched: true, albumMatched: true, decision: 'bound',
          identity: { method: 'path', plexFilePath: normalizePlexPath(identity.plexPath), bindingStatus: 'active' }, }),
      }
    }
    const reviewResolution = await pendingReview(base, song, found, sectionKey, cfg, identityContext, dryRun,
      'Plex 搜索命中仅是元数据候选，未获得路径或 MB recording 强证据')
    if (reviewResolution) return reviewResolution
  }

  // Plex agents often replace the artist/album with Various Artists or an
  // unknown album. A title-only playlist hit is evidence for review, never a
  // reason to download another copy or delete the old playlist item.
  const weakPlaylistCandidate = plexTracks.find(track => fuzzyMatchTitle(track.title, song.name))
  if (weakPlaylistCandidate) {
    const reviewResolution = await pendingReview(base, song, weakPlaylistCandidate, sectionKey, cfg, identityContext, dryRun,
      'Plex 歌单中存在同标题但元数据漂移的候选，等待路径或 MusicBrainz recording 确认')
    if (reviewResolution) return reviewResolution
  }

  // ── Step 5: Check disk ──
  const expectedPath = cached?.file_path ?? expectedLocalPath
  const accessiblePath = resolveAccessibleLocalPath(expectedPath, cfg)
  if (accessiblePath) {
    const validation = validateLocalAudioFile(accessiblePath)
    if (!validation.valid) {
      if (!dryRun) clearSongLookupFilePath(song.id)
      return {
        ...base,
        resolution: 'needs_download',
        matchTrace: buildMatchTrace('invalid_local_file', {
          filePath: accessiblePath,
          message: validation.reason || '本地音频文件无效，将重新下载',
        }),
      }
    }
    if (!dryRun) upsertLookup(db, song.id, null, accessiblePath)
    return {
      ...base,
      resolution: 'found_on_disk',
      filePath: accessiblePath,
      matchTrace: buildMatchTrace('disk', { filePath: accessiblePath }),
    }
  }
  if (expectedPath && !dryRun) {
    clearSongLookupFilePath(song.id)
  }

  // ── Step 6: Downloadable or unavailable ──
  return {
    ...base,
    resolution: 'needs_download',
    matchTrace: buildMatchTrace('download_required', { message: '未在 Plex 或本地磁盘找到可用歌曲' }),
  }
}

/** Quick Plex metadata lookup — one cheap API call to verify track still exists */
async function quickVerify(plexRatingKey: string) {
  return getTrackByRatingKey(plexRatingKey)
}

export function upsertLookup(db: ReturnType<typeof getDb>, neteaseSongId: number, plexRatingKey: string | null, filePath: string | null) {
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO song_lookup (netease_song_id, plex_rating_key, file_path, last_verified_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(netease_song_id) DO UPDATE SET
      plex_rating_key = COALESCE(excluded.plex_rating_key, song_lookup.plex_rating_key),
      file_path = COALESCE(excluded.file_path, song_lookup.file_path),
      last_verified_at = excluded.last_verified_at
  `).run(neteaseSongId, plexRatingKey, filePath, now)
}

function trackPath(track: PlexTrack | null | undefined): string | null {
  return trackPaths(track)[0] ?? null
}

function trackPaths(track: PlexTrack | null | undefined): string[] {
  return track?.Media?.flatMap(media => media.Part?.map(part => part.file).filter((file): file is string => Boolean(file)) ?? []) ?? []
}

function matchingTrackPath(track: PlexTrack | null | undefined, expectedPath: string): string | null {
  const expected = normalizePlexPath(expectedPath)
  const paths = trackPaths(track)
  const exact = paths.find(path => normalizePlexPath(path) === expected)
  if (exact) return exact
  const foldedExpected = expected.toLowerCase()
  const folded = paths.filter(path => normalizePlexPath(path).toLowerCase() === foldedExpected)
  const uniquePaths = [...new Set(folded.map(normalizePlexPath))]
  return uniquePaths.length === 1 ? folded[0]! : null
}

function findTrackPathMatches(
  tracks: PlexTrack[],
  expectedPath: string,
): Array<{ track: PlexTrack; path: string }> {
  const expected = normalizePlexPath(expectedPath)
  const exactMatches = tracks.flatMap(track => trackPaths(track)
    .filter(path => normalizePlexPath(path) === expected)
    .map(path => ({ track, path })))
  if (exactMatches.length > 0) return uniqueTrackPathMatches(exactMatches)

  const foldedExpected = expected.toLowerCase()
  const foldedMatches = tracks.flatMap(track => trackPaths(track)
    .filter(path => normalizePlexPath(path).toLowerCase() === foldedExpected)
    .map(path => ({ track, path })))
  const uniqueMatches = uniqueTrackPathMatches(foldedMatches)
  const exactPaths = new Set(uniqueMatches.map(({ path }) => normalizePlexPath(path)))
  return exactPaths.size === 1 ? uniqueMatches : []
}

function uniqueTrackPathMatches(
  matches: Array<{ track: PlexTrack; path: string }>,
): Array<{ track: PlexTrack; path: string }> {
  const seen = new Set<string>()
  return matches.filter(({ track, path }) => {
    const identity = `${track.ratingKey}\0${normalizePlexPath(path)}`
    if (seen.has(identity)) return false
    seen.add(identity)
    return true
  })
}

function ambiguousPathResolution(input: {
  base: Omit<TrackResolution, 'resolution'>
  song: NeteaseSong
  expectedLocalPath: string | null
  plexPath: string
  ownership: 'managed' | 'external'
  provenance: string
  identityContext: IdentityContext
  dryRun: boolean
  matches: Array<{ track: PlexTrack; path: string }>
}): TrackResolution {
  const conflictingRatingKeys = [...new Set(input.matches.map(match => match.track.ratingKey))]
  const reason = '多个 Plex 曲目指向同一个文件路径，无法安全选择 ratingKey'
  const review = input.dryRun ? null : createMatchReview({
    neteaseSongId: input.song.id,
    sourceId: input.identityContext.sourceId,
    runId: input.identityContext.runId,
    candidatePlexFilePath: normalizePlexPath(input.plexPath),
    candidatePlexRatingKey: null,
    evidenceType: 'path',
    evidence: {
      reason,
      localOwnership: input.ownership,
      localProvenance: input.provenance,
      conflictingRatingKeys,
    },
  })
  return {
    ...input.base,
    resolution: 'needs_review',
    filePath: input.expectedLocalPath ?? undefined,
    matchTrace: buildMatchTrace('pending_review', {
      filePath: input.expectedLocalPath ?? undefined,
      message: reason,
      decision: 'pending_review',
      deletionProtectionReason: '同一路径存在多个 Plex 身份，已保留旧歌单项',
      evidence: {
        localOwnership: input.ownership,
        localProvenance: input.provenance,
        conflictingRatingKeys,
      },
      candidate: {
        plexFilePath: normalizePlexPath(input.plexPath),
        ratingKey: null,
        reviewId: review?.id,
      },
    }),
  }
}

function samePath(first: string, second: string): boolean {
  const normalize = (value: string) => value.normalize('NFC').replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/$/, '')
  return normalize(first) === normalize(second)
}

async function getTrackPaths(
  ratingKey: string,
  cfg: AppConfig,
  expectedLocalPath?: string | null,
): Promise<{ plexPath: string | null; localPath: string | null }> {
  const candidates = (await getTrackFilePathsByRatingKey(ratingKey)).map(plexPath => ({
    plexPath,
    localPath: resolveAccessibleLocalPath(plexPath, cfg),
  }))
  const exact = expectedLocalPath
    ? candidates.find(candidate => candidate.localPath && samePath(candidate.localPath, expectedLocalPath))
    : undefined
  return exact ?? candidates.find(candidate => candidate.localPath) ?? candidates[0]
    ?? { plexPath: null, localPath: null }
}

function bindPath(
  songId: number,
  sectionKey: string,
  ratingKey: string,
  plexPath: string,
  mbRecordingId: string | undefined,
  method: 'path' | 'mb_recording' | 'metadata' | 'migrated',
  evidence: Record<string, unknown>,
  db: ReturnType<typeof getDb>,
  localPath: string | null,
): void {
  upsertVerifiedSongIdentityBinding({
    neteaseSongId: songId, plexSectionKey: sectionKey, plexFilePath: plexPath, plexRatingKey: ratingKey,
    mbRecordingId: mbRecordingId ?? null, bindingMethod: method, status: 'active', evidence,
  })
  upsertLookup(db, songId, ratingKey, localPath)
}

async function pendingReview(
  base: Omit<TrackResolution, 'resolution'>,
  song: NeteaseSong,
  candidate: PlexTrack | { ratingKey: string; title: string; grandparentTitle: string; parentTitle: string; playlistItemID?: number },
  sectionKey: string,
  cfg: AppConfig,
  context: { sourceId?: string; runId?: string },
  dryRun: boolean,
  reason: string,
  additionalEvidence: Record<string, unknown> = {},
): Promise<TrackResolution | null> {
  const fullCandidate = await getTrackByRatingKey(candidate.ratingKey) ?? candidate
  const plexPath = trackPath(fullCandidate)
  if (!dryRun && findRejectedMatchReview({
    neteaseSongId: song.id,
    candidatePlexFilePath: plexPath,
    candidatePlexRatingKey: fullCandidate.ratingKey,
  })) {
    return null
  }
  const durationToleranceMs = (cfg.sync.metadataDurationToleranceSec ?? 2) * 1000
  const neteaseProviderIdentity = getPlexTrackNeteaseIdentity(fullCandidate)
  const neteaseProviderEvidence = neteaseProviderIdentity
    ? evaluateNeteaseProviderIdentity(song, fullCandidate, neteaseProviderIdentity, durationToleranceMs)
    : null
  if (plexPath && neteaseProviderEvidence?.matched) {
    if (!dryRun) {
      bindPath(song.id, sectionKey, fullCandidate.ratingKey, plexPath, undefined, 'metadata', {
        source: 'plex_netease_provider', reason, neteaseProviderEvidence,
      }, getDb(), resolveAccessibleLocalPath(plexPath, cfg))
    }
    const playlistItemId = candidate.playlistItemID
    return {
      ...base, resolution: playlistItemId ? 'matched_plex_playlist' : 'found_in_plex_library',
      plexRatingKey: fullCandidate.ratingKey, playlistItemId,
      filePath: resolveAccessibleLocalPath(plexPath, cfg) ?? undefined,
      matchTrace: buildMatchTrace('provider_identity', {
        ratingKey: fullCandidate.ratingKey,
        filePath: resolveAccessibleLocalPath(plexPath, cfg) ?? undefined,
        titleMatched: true, artistMatched: true, albumMatched: true, decision: 'bound',
        identity: { method: 'metadata', plexFilePath: normalizePlexPath(plexPath), mbRecordingId: null, bindingStatus: 'active' },
      }),
    }
  }
  const plexMusicBrainzIdentity = getPlexTrackMusicBrainzIdentity(fullCandidate)
  const resolvedArtistNames = cfg.other?.enableMusicBrainzResolver || cfg.sync.enableHighConfidenceMetadataBinding
    ? await resolveSongArtistCandidateNames(song.artists)
    : song.artists.map(artist => artist.name)
  const durationResolutionOptions = {
    durationMs: song.dt,
    durationToleranceMs,
  }
  let candidateRecordingId = plexMusicBrainzIdentity.explicitRecordingId
  let desiredRecordingId: string | null = null
  let desiredRecordingEvidence: Awaited<ReturnType<typeof resolveRecording>> = null
  let candidateRecordingEvidence: Awaited<ReturnType<typeof resolveRecording>> = null
  const plexIdMappings: Awaited<ReturnType<typeof resolveMusicBrainzIdToRecording>>[] = []
  if (cfg.other?.enableMusicBrainzResolver && plexPath) {
    desiredRecordingEvidence = await resolveRecording(
      song.name,
      resolvedArtistNames,
      song.album.name,
      durationResolutionOptions,
    )
    desiredRecordingId = desiredRecordingEvidence?.id ?? null
    if (!candidateRecordingId && plexMusicBrainzIdentity.untypedIds.length > 0) {
      for (const untypedId of plexMusicBrainzIdentity.untypedIds) {
        plexIdMappings.push(await resolveMusicBrainzIdToRecording(untypedId))
      }
      const mappedRecordingIds = [...new Set(plexIdMappings
        .filter(mapping => mapping.status === 'success' && mapping.recordingId)
        .map(mapping => mapping.recordingId!))]
      // Every generic ID must resolve successfully to the same recording.
      // Partial failures and conflicting IDs remain review-only evidence.
      if (plexIdMappings.every(mapping => mapping.status === 'success') && mappedRecordingIds.length === 1) {
        candidateRecordingId = mappedRecordingIds[0]!
      }
    }
    if (!candidateRecordingId && plexMusicBrainzIdentity.untypedIds.length === 0) {
      candidateRecordingEvidence = await resolveRecording(
        fullCandidate.title,
        // Resolve both sides against the same canonical artist universe.
        // Adding Plex's combined display credit (for example `A&B`) changes
        // MusicBrainz relevance scores and can make identical media resolve to
        // different recordings even when the individual artists are known.
        resolvedArtistNames,
        fullCandidate.parentTitle || '',
        {
          durationMs: 'duration' in fullCandidate && typeof fullCandidate.duration === 'number'
            ? fullCandidate.duration
            : song.dt,
          durationToleranceMs: durationResolutionOptions.durationToleranceMs,
        },
      )
      candidateRecordingId = candidateRecordingEvidence?.id ?? null
    }
    if (desiredRecordingId && candidateRecordingId && desiredRecordingId === candidateRecordingId) {
      if (!dryRun) {
        bindPath(song.id, sectionKey, fullCandidate.ratingKey, plexPath, desiredRecordingId, 'mb_recording', {
          source: 'musicbrainz_recording', reason, desiredRecordingId, candidateRecordingId,
          desiredRecordingEvidence, candidateRecordingEvidence,
          plexMusicBrainzIdentity, plexIdMappings,
        }, getDb(), resolveAccessibleLocalPath(plexPath, cfg))
      }
      const playlistItemId = candidate.playlistItemID
      return {
        ...base, resolution: playlistItemId ? 'matched_plex_playlist' : 'found_in_plex_library',
        plexRatingKey: fullCandidate.ratingKey, playlistItemId, filePath: resolveAccessibleLocalPath(plexPath, cfg) ?? undefined,
        matchTrace: buildMatchTrace('mb_recording_migration', {
          ratingKey: fullCandidate.ratingKey, filePath: resolveAccessibleLocalPath(plexPath, cfg) ?? undefined,
          decision: 'migrated', identity: { method: 'mb_recording', plexFilePath: normalizePlexPath(plexPath), mbRecordingId: desiredRecordingId, bindingStatus: 'active' },
        }),
      }
    }
  }
  const metadataEvidence = evaluateHighConfidenceMetadataMatch(
    song,
    fullCandidate,
    durationToleranceMs,
    resolvedArtistNames,
  )
  const metadataMusicBrainzDecision = evaluateMetadataBindingMusicBrainzEvidence({
    desiredRecordingId,
    candidateRecordingId,
    desiredEvidence: desiredRecordingEvidence,
    candidateEvidence: candidateRecordingEvidence,
    plexUntypedIdCount: plexMusicBrainzIdentity.untypedIds.length,
    plexIdMappings,
    durationToleranceMs,
  })
  if (
    cfg.sync.enableHighConfidenceMetadataBinding
    && plexPath
    && metadataMusicBrainzDecision.allowed
    && metadataEvidence.matched
  ) {
    const bindingRecordingId = metadataMusicBrainzDecision.confirmedRecordingId ?? undefined
    const bindingMethod = bindingRecordingId ? 'mb_recording' : 'metadata'
    if (!dryRun) {
      bindPath(song.id, sectionKey, fullCandidate.ratingKey, plexPath, bindingRecordingId, bindingMethod, {
        source: 'high_confidence_metadata',
        reason,
        metadataEvidence,
        metadataMusicBrainzDecision,
        desiredRecordingEvidence,
        candidateRecordingEvidence,
        plexMusicBrainzIdentity,
        plexIdMappings,
      }, getDb(), resolveAccessibleLocalPath(plexPath, cfg))
    }
    const playlistItemId = candidate.playlistItemID
    return {
      ...base,
      resolution: playlistItemId ? 'matched_plex_playlist' : 'found_in_plex_library',
      plexRatingKey: fullCandidate.ratingKey,
      playlistItemId,
      filePath: resolveAccessibleLocalPath(plexPath, cfg) ?? undefined,
      matchTrace: buildMatchTrace('high_confidence_metadata', {
        ratingKey: fullCandidate.ratingKey,
        filePath: resolveAccessibleLocalPath(plexPath, cfg) ?? undefined,
        titleMatched: true,
        artistMatched: true,
        albumMatched: true,
        decision: 'bound',
        evidence: { metadataMusicBrainzDecision },
        identity: {
          method: bindingMethod,
          plexFilePath: normalizePlexPath(plexPath),
          mbRecordingId: bindingRecordingId ?? null,
          bindingStatus: 'active',
        },
      }),
    }
  }
  const review = dryRun ? null : createMatchReview({
    neteaseSongId: song.id, sourceId: context.sourceId, runId: context.runId,
    candidatePlexFilePath: plexPath, candidatePlexRatingKey: fullCandidate.ratingKey,
    candidateMbRecordingId: candidateRecordingId,
    evidence: {
      ...additionalEvidence,
      reason, desired: { title: song.name, artists: song.artists.map(item => item.name), album: song.album.name, mbRecordingId: desiredRecordingId },
      candidate: { title: fullCandidate.title, artist: fullCandidate.grandparentTitle, album: fullCandidate.parentTitle, mbRecordingId: candidateRecordingId },
      musicBrainz: {
        desired: desiredRecordingEvidence,
        candidate: candidateRecordingEvidence,
        plexIdentity: plexMusicBrainzIdentity,
        plexIdMappings,
      },
      highConfidenceMetadata: {
        enabled: cfg.sync.enableHighConfidenceMetadataBinding,
        eligibleWithoutMusicBrainz: metadataMusicBrainzDecision.mode === 'unavailable',
        musicBrainzDecision: metadataMusicBrainzDecision,
        evidence: metadataEvidence,
      },
      neteaseProviderIdentity: neteaseProviderEvidence,
    },
  })
  return {
    ...base, resolution: 'needs_review',
    matchTrace: buildMatchTrace('pending_review', {
      ratingKey: fullCandidate.ratingKey, filePath: plexPath ? resolveAccessibleLocalPath(plexPath, cfg) ?? undefined : undefined,
      message: reason, decision: 'pending_review', deletionProtectionReason: '存在未确认的 Plex 匹配候选，已保留旧歌单项',
      evidence: additionalEvidence,
      candidate: { plexFilePath: plexPath, ratingKey: fullCandidate.ratingKey, mbRecordingId: candidateRecordingId, reviewId: review?.id },
    }),
  }
}

// ── Title matching (unchanged from original) ──

function normalizeTitle(title: string): string {
  return title.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s*\[[^\]]*\]\s*/g, ' ').trim()
}

function stripPunct(s: string): string {
  return s.toLowerCase().replace(/[/\\:*?"'<>|&\s‘’“”]+/g, '')
}

function fuzzyMatchTitle(plexTitle: string, yunTitle: string): boolean {
  if (!titleIdentityDescriptorsCompatible(plexTitle, yunTitle)) return false
  const y = normalizeTitle(yunTitle)
  const p = normalizeTitle(plexTitle)
  if (!y || !p) return false

  if (y === p || stripPunct(y) === stripPunct(p)) {
    const yHasExtra = /[([].+[\])]/.test(yunTitle)
    const pHasExtra = /[([].+[\])]/.test(plexTitle)
    if (yHasExtra !== pHasExtra) {
      const base = yHasExtra ? plexTitle : yunTitle
      if (base && base.trim().length <= 3) return false
    }
    return true
  }
  return false
}

function fuzzyMatchAlbum(plexAlbum: string, yunAlbum: string): boolean {
  if (!yunAlbum || !plexAlbum) return true
  const y = normalizeTitle(yunAlbum)
  const p = normalizeTitle(plexAlbum || '')
  return y === p || stripPunct(y) === stripPunct(p) || stripPunct(y).includes(stripPunct(p)) || stripPunct(p).includes(stripPunct(y))
}

// ── Backward-compat exports ──

export { isArtistNameMatch as fuzzyArtist, anyCandidateMatches, normalizeArtistName }
export type { ArtistCandidate }

/** @deprecated — use fuzzyMatchTitle (local) or isArtistNameMatch for artists */
export function fuzzyMatch(plexTitle: string, yunTitle: string): boolean {
  return fuzzyMatchTitle(plexTitle, yunTitle)
}

/** @deprecated — use fuzzyMatchAlbum (local) */
export function fuzzyAlbum(plexAlbum: string, yunAlbum: string): boolean {
  return fuzzyMatchAlbum(plexAlbum, yunAlbum)
}

function dedupeResolutionBinding(
  resolution: TrackResolution,
  claimedBindings: Map<string, TrackResolution>,
): TrackResolution {
  const bindingKeys = [resolution.plexRatingKey, resolution.filePath].filter(Boolean) as string[]
  for (const bindingKey of bindingKeys) {
    const claimed = claimedBindings.get(bindingKey)
    if (!claimed) continue
    if (claimed.song.id === resolution.song.id) continue
    return {
      neteaseIndex: resolution.neteaseIndex,
      song: resolution.song,
      resolution: 'needs_download',
      matchTrace: buildMatchTrace('dedupe_conflict', {
        conflictReason: `${bindingKey} 已被网易云歌曲 ${claimed.song.id} 占用`,
      }),
    }
  }

  for (const bindingKey of bindingKeys) {
    claimedBindings.set(bindingKey, resolution)
  }
  return resolution
}

function buildMatchTrace(source: MatchTrace['source'], input: Omit<MatchTrace, 'source'>): MatchTrace {
  return {
    source,
    ...input,
  }
}
