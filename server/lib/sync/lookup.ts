import type { AppConfig } from '../config/types'
import {
  searchTrackCandidates, getPlaylistTracks, getTrackByRatingKey, getTrackFilePathsByRatingKey,
  findTracksByFilePath, getPlexTrackRecordingId, type PlexTrack,
} from '../plex-client'
import type { NeteaseSong } from '../netease'
import type { MatchTrace, TrackResolution } from './types'
import { anyCandidateMatches, normalizeArtistName } from './artist-match'
import type { ArtistCandidate } from './artist-resolver'
import { mapLocalPathToPlex, resolveAccessibleLocalPath } from './path-map'
import { resolveSongArtistCandidateNames } from './song-artist-candidates'
import { albumsMatchConservatively, titleCoresEqual, titlesMatchConservatively } from './matchers'
import { findExistingLocalSongPath } from './local-file-discovery'
import {
  persistLocalMediaInspection,
  inspectLocalMediaAssets,
  resolveLocalMediaAsset,
  type LocalMediaAsset,
  type LocalMediaInspection,
} from './local-media-store'
import { validateLocalAudioFile } from '../media-validation'
import {
  createMatchReview, getSongIdentityBinding, markSongIdentityBindingStale, upsertVerifiedSongIdentityBinding,
} from './identity-store'
import {
  foldPlexPath,
  normalizePlexPath,
  plexPathsExactlyEqual,
  resolvePlexIdentityPath,
} from './identity-normalization'
import { planMissingMedia, type MissingMediaPlan } from './missing-media-policy'
import { bindResolvedIdentity } from './lookup-identity'
import { resolveReviewCandidate } from './lookup-review'

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
  options: { downloadWhenMediaMissing?: boolean } = {},
): Promise<{ resolutions: TrackResolution[]; extraTracks: ExtraTrack[] }> {
  const plexPlaylistTracks = plexPlaylistRatingKey
    ? await getPlaylistTracks(plexPlaylistRatingKey, 99999)
    : []

  const resolutions: TrackResolution[] = []
  const usedPlexKeys = new Set<string>()
  const claimedBindings = new Map<string, TrackResolution>()
  const mediaPlans = options.downloadWhenMediaMissing
    ? planMissingMedia(yunSongs, cfg, { validateAudio: true })
    : new Map<number, MissingMediaPlan>()
  const previewInspections = dryRun && !options.downloadWhenMediaMissing
    ? inspectLocalMediaAssets(yunSongs, cfg)
    : new Map<number, LocalMediaInspection>()

  for (let i = 0; i < yunSongs.length; i++) {
    const song = yunSongs[i]!
    const resolution = await resolveOne(
      song,
      i,
      plexPlaylistTracks,
      sectionKey,
      cfg,
      dryRun,
      identityContext,
      mediaPlans.get(song.id),
      previewInspections.get(song.id),
    )
    const mediaPlan = mediaPlans.get(song.id)
    if (mediaPlan) annotateMediaPolicy(resolution, mediaPlan)
    const dedupedResolution = dedupeResolutionBinding(resolution, claimedBindings)
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

function annotateMediaPolicy(resolution: TrackResolution, mediaPlan: MissingMediaPlan): void {
  resolution.mediaPolicy = {
    disposition: mediaPlan.disposition,
    ...(mediaPlan.audioPath ? { audioPath: mediaPlan.audioPath } : {}),
    ...(mediaPlan.protectedAudioPath
      ? { protectedAudioPath: mediaPlan.protectedAudioPath }
      : {}),
  }
  resolution.matchTrace = resolution.matchTrace
    ? {
        ...resolution.matchTrace,
        evidence: {
          ...resolution.matchTrace.evidence,
          mediaPolicy: mediaPlan.disposition,
          mediaPolicyMessage: mediaPlan.message,
        },
      }
    : buildMatchTrace('media_policy', {
        filePath: mediaPlan.filePath ?? undefined,
        message: mediaPlan.message,
        evidence: { mediaPolicy: mediaPlan.disposition },
      })
}

async function resolveOne(
  song: NeteaseSong,
  index: number,
  plexTracks: PlexTrack[],
  sectionKey: string,
  cfg: AppConfig,
  dryRun: boolean,
  identityContext: IdentityContext,
  mediaPlan?: MissingMediaPlan,
  previewInspection?: LocalMediaInspection,
): Promise<TrackResolution> {
  const base: Omit<TrackResolution, 'resolution'> = { neteaseIndex: index, song }
  const localAsset = mediaPlan
    ? dryRun
      ? inspectionAsset(mediaPlan.inspection)
      : persistLocalMediaInspection(mediaPlan.inspection)
    : previewInspection
      ? inspectionAsset(previewInspection)
    : resolveLocalMediaAsset(song, cfg)
  const expectedLocalPath = localAsset?.filePath ?? findExistingLocalSongPath(song, cfg)
  const expectedPlexPath = mapLocalPathToPlex(expectedLocalPath, cfg)
  const managedLocalIdentity = localAsset?.ownership === 'managed' && localAsset.status === 'active'
  const policyRequiresDownload = mediaPlan?.disposition === 'download_missing'
    || mediaPlan?.disposition === 'redownload_replaced'

  // ── Step 0: durable identity binding ────────────────────────────────
  // Binding is intentionally checked before Plex metadata. Plex's agent can
  // rewrite artist/album fields, but it must never turn the same media file
  // into an "extra" track.
  const bound = getSongIdentityBinding(song.id)
  if (
    bound?.status === 'active'
    && !policyRequiresDownload
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
    if (bound.bindingMethod !== 'manual' && !dryRun) {
      markSongIdentityBindingStale(song.id, { reason: 'bound_path_not_found', plexFilePath: currentBoundPlexPath })
    }
  }

  if (mediaPlan?.disposition === 'manual_exempt') {
    return {
      ...base,
      resolution: 'needs_review',
      mediaPolicy: { disposition: mediaPlan.disposition },
      matchTrace: buildMatchTrace('media_policy', {
        message: '人工绑定当前无法在 Plex 中验证，已豁免自动下载并保留人工决定',
        decision: 'preserved',
        deletionProtectionReason: '人工绑定豁免自动下载，旧 Plex 项禁止删除',
        evidence: { mediaPolicy: mediaPlan.disposition },
      }),
    }
  }

  if (policyRequiresDownload && mediaPlan) {
    return {
      ...base,
      resolution: 'needs_download',
      filePath: mediaPlan.filePath ?? undefined,
      mediaPolicy: {
        disposition: mediaPlan.disposition,
        ...(mediaPlan.audioPath ? { audioPath: mediaPlan.audioPath } : {}),
        ...(mediaPlan.protectedAudioPath
          ? { protectedAudioPath: mediaPlan.protectedAudioPath }
          : {}),
      },
      matchTrace: buildMatchTrace('media_policy', {
        filePath: mediaPlan.filePath ?? undefined,
        message: mediaPlan.message,
        evidence: {
          mediaPolicy: mediaPlan.disposition,
          previousBindingPreservedUntilReplacement: bound?.status === 'active',
          previousRatingKey: bound?.plexRatingKey ?? null,
        },
      }),
    }
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
        const reviewResolution = await resolveReviewCandidate(
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
          bindResolvedIdentity(song.id, sectionKey, exactTrack.ratingKey, exactTrackPath, undefined, 'path', {
            source: inPlaylistByPath ? 'managed_playlist_exact_path' : 'managed_library_exact_path',
            ownership: 'managed',
            localProvenance: localAsset?.provenance ?? 'download_task',
            sourceTaskId: localAsset?.sourceTaskId ?? null,
          })
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
            titleMatched: titlesMatchConservatively(exactTrack.title, song.name),
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
  const playlistCandidates = plexTracks.filter((pt) =>
    titlesMatchConservatively(pt.title, song.name) &&
    anyCandidateMatches(pt.grandparentTitle, artistCandidates) &&
    albumsMatchConservatively(pt.parentTitle, song.album.name),
  )
  if (playlistCandidates.length > 1) {
    const ordered = playlistCandidates.toSorted((left, right) => left.ratingKey.localeCompare(right.ratingKey))
    const reviewResolution = await resolveReviewCandidate(
      base,
      song,
      ordered[0]!,
      sectionKey,
      cfg,
      identityContext,
      dryRun,
      'Plex 歌单存在多个同等候选，不能按返回顺序自动选择',
      {
        automaticBindingAllowed: false,
        conflictingRatingKeys: ordered.map(candidate => candidate.ratingKey),
      },
    )
    if (reviewResolution) return reviewResolution
  }
  const inPlaylist = playlistCandidates[0]
  if (inPlaylist && inPlaylist.playlistItemID) {
    const identity = await getTrackPaths(inPlaylist.ratingKey, cfg, expectedLocalPath)
    if (identity.plexPath && identity.localPath && expectedLocalPath && samePath(identity.localPath, expectedLocalPath)) {
      if (!dryRun) bindResolvedIdentity(song.id, sectionKey, inPlaylist.ratingKey, identity.plexPath, undefined, 'path', { source: 'playlist_exact_path' })
      return {
        ...base, resolution: 'matched_plex_playlist', plexRatingKey: inPlaylist.ratingKey,
        playlistItemId: inPlaylist.playlistItemID, filePath: identity.localPath,
        matchTrace: buildMatchTrace('playlist', { ratingKey: inPlaylist.ratingKey, filePath: identity.localPath,
          titleMatched: true, artistMatched: true, albumMatched: true, decision: 'bound',
          identity: { method: 'path', plexFilePath: normalizePlexPath(identity.plexPath), bindingStatus: 'active' }, }),
      }
    }
    const reviewResolution = await resolveReviewCandidate(base, song, inPlaylist, sectionKey, cfg, identityContext, dryRun,
      'Plex 歌单候选的文件路径未能与本地目标精确对应，已保留旧条目等待审核')
    if (reviewResolution) return reviewResolution
  }

  // ── Step 3: Search Plex library (now with resolved artist candidates) ──
  const searchResult = await searchTrackCandidates(sectionKey, song.name, artistCandidateNames, song.album.name)
  const found = searchResult.match
  if (found) {
    const identity = await getTrackPaths(found.ratingKey, cfg, expectedLocalPath)
    if (identity.plexPath && identity.localPath && expectedLocalPath && samePath(identity.localPath, expectedLocalPath)) {
      if (!dryRun) bindResolvedIdentity(song.id, sectionKey, found.ratingKey, identity.plexPath, undefined, 'path', { source: 'plex_search_exact_path' })
      return {
        ...base, resolution: 'found_in_plex_library', plexRatingKey: found.ratingKey, filePath: identity.localPath,
        matchTrace: buildMatchTrace('plex_search', { ratingKey: found.ratingKey, filePath: identity.localPath,
          titleMatched: true, artistMatched: true, albumMatched: true, decision: 'bound',
          identity: { method: 'path', plexFilePath: normalizePlexPath(identity.plexPath), bindingStatus: 'active' }, }),
      }
    }
    const reviewResolution = await resolveReviewCandidate(base, song, found, sectionKey, cfg, identityContext, dryRun,
      'Plex 搜索命中仅是元数据候选，未获得路径或 MB recording 强证据')
    if (reviewResolution) return reviewResolution
  }
  if (!found) {
    const ambiguousLibraryCandidates = searchResult.candidates
      .filter(track =>
        titleCoresEqual(track.title, song.name)
        && anyCandidateMatches(track.grandparentTitle, artistCandidates),
      )
    if (ambiguousLibraryCandidates.length > 0) {
      const candidate = ambiguousLibraryCandidates[0]!
      const reviewResolution = await resolveReviewCandidate(
        base,
        song,
        candidate,
        sectionKey,
        cfg,
        identityContext,
        dryRun,
        'Plex 音乐库存在一个或多个元数据候选，但没有唯一强证据',
        {
          automaticBindingAllowed: false,
          conflictingRatingKeys: ambiguousLibraryCandidates.map(track => track.ratingKey),
        },
      )
      if (reviewResolution) return reviewResolution
    }
  }

  // Plex agents often replace the artist/album with Various Artists or an
  // unknown album. A title-only playlist hit is evidence for review, never a
  // reason to download another copy or delete the old playlist item.
  const weakPlaylistCandidate = plexTracks.find(track => titleCoresEqual(track.title, song.name))
  if (weakPlaylistCandidate) {
    const reviewResolution = await resolveReviewCandidate(base, song, weakPlaylistCandidate, sectionKey, cfg, identityContext, dryRun,
      'Plex 歌单中存在同标题但元数据漂移的候选，等待路径或 MusicBrainz recording 确认')
    if (reviewResolution) return reviewResolution
  }

  // ── Step 4: Check disk ──
  const expectedPath = expectedLocalPath
  const accessiblePath = resolveAccessibleLocalPath(expectedPath, cfg)
  if (accessiblePath) {
    const validation = validateLocalAudioFile(accessiblePath)
    if (!validation.valid) {
      return {
        ...base,
        resolution: 'needs_download',
        matchTrace: buildMatchTrace('invalid_local_file', {
          filePath: accessiblePath,
          message: validation.reason || '本地音频文件无效，将重新下载',
        }),
      }
    }
    return {
      ...base,
      resolution: 'found_on_disk',
      filePath: accessiblePath,
      matchTrace: buildMatchTrace('disk', { filePath: accessiblePath }),
    }
  }
  // ── Step 5: Downloadable or unavailable ──
  return {
    ...base,
    resolution: 'needs_download',
    matchTrace: buildMatchTrace('download_required', { message: '未在 Plex 或本地磁盘找到可用歌曲' }),
  }
}

function inspectionAsset(inspection: LocalMediaInspection): LocalMediaAsset | null {
  if (inspection.asset) return inspection.asset
  if (!inspection.discovery || !inspection.filePath) return null
  return {
    neteaseSongId: inspection.neteaseSongId,
    filePath: inspection.filePath,
    provenance: inspection.discovery.provenance,
    ownership: inspection.discovery.ownership,
    sourceTaskId: inspection.discovery.sourceTaskId,
    status: 'active',
    fileSize: null,
    fileMtimeMs: null,
    evidence: inspection.discovery.evidence,
    createdAt: '',
    updatedAt: '',
    lastVerifiedAt: null,
  }
}

/** Quick Plex metadata lookup — one cheap API call to verify track still exists */
async function quickVerify(plexRatingKey: string) {
  return getTrackByRatingKey(plexRatingKey)
}

function trackPaths(track: PlexTrack | null | undefined): string[] {
  return track?.Media?.flatMap(media => media.Part?.map(part => part.file).filter((file): file is string => Boolean(file)) ?? []) ?? []
}

function matchingTrackPath(track: PlexTrack | null | undefined, expectedPath: string): string | null {
  const expected = normalizePlexPath(expectedPath)
  const paths = trackPaths(track)
  const exact = paths.find(path => normalizePlexPath(path) === expected)
  if (exact) return exact
  const foldedExpected = foldPlexPath(expected)
  const folded = paths.filter(path => foldPlexPath(path) === foldedExpected)
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

  const foldedExpected = foldPlexPath(expected)
  const foldedMatches = tracks.flatMap(track => trackPaths(track)
    .filter(path => foldPlexPath(path) === foldedExpected)
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
  return plexPathsExactlyEqual(first, second)
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

export { anyCandidateMatches, normalizeArtistName }
export type { ArtistCandidate }

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
