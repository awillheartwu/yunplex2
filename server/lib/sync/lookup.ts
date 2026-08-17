import type { AppConfig } from '../config/types'
import { findTracksByFilePath, getPlaylistTracks, getTrackByRatingKey, type PlexTrack } from '../plex-client'
import type { NeteaseSong } from '../netease'
import { validateLocalAudioFile } from '../media-validation'
import type { MatchTrace, TrackResolution } from './types'
import { findExistingLocalSongPath } from './local-file-discovery'
import {
  inspectLocalMediaAssets,
  persistLocalMediaInspection,
  resolveLocalMediaAsset,
  type LocalMediaAsset,
  type LocalMediaInspection,
} from './local-media-store'
import { mapLocalPathToPlex, resolveAccessibleLocalPath } from './path-map'
import { planMissingMedia, type MissingMediaPlan } from './missing-media-policy'
import {
  getSongIdentityBinding,
  markSongIdentityBindingStale,
  upsertVerifiedSongIdentityBinding,
} from './identity-store'
import {
  foldPlexPath,
  normalizePlexPath,
  resolvePlexIdentityPath,
} from './identity-normalization'
import { bindResolvedIdentity } from './lookup-identity'

type IdentityContext = { sourceId?: string; runId?: string }

export interface ExtraTrack {
  playlistItemId: number
  ratingKey: string
  title: string
  artist: string
  album: string
  plexFilePaths: string[]
  protectionReason?: string
}

/**
 * Resolve Target Songs through two identity facts only:
 *
 * 1. an explicit adopted Plex track (`manual` binding);
 * 2. a YunPlex-managed local file found in Plex by exact Media.Part.file path.
 *
 * Plex display metadata and external identity providers are deliberately absent.
 * If neither fact can be verified, the safe automatic fallback is a managed download.
 */
export async function resolveTracks(
  yunSongs: NeteaseSong[],
  plexPlaylistRatingKey: string,
  sectionKey: string,
  cfg: AppConfig,
  dryRun = false,
  identityContext: IdentityContext = {},
  options: { automaticMediaFallback?: boolean } = {},
): Promise<{ resolutions: TrackResolution[]; extraTracks: ExtraTrack[] }> {
  const playlistTracks = plexPlaylistRatingKey
    ? await getPlaylistTracks(plexPlaylistRatingKey, 99999)
    : []
  const mediaPlans = options.automaticMediaFallback
    ? planMissingMedia(yunSongs, cfg, { validateAudio: true })
    : new Map<number, MissingMediaPlan>()
  const previewInspections = dryRun && !options.automaticMediaFallback
    ? inspectLocalMediaAssets(yunSongs, cfg)
    : new Map<number, LocalMediaInspection>()

  const resolutions: TrackResolution[] = []
  const claimedRatingKeys = new Map<string, number>()
  const usedRatingKeys = new Set<string>()

  for (const [index, song] of yunSongs.entries()) {
    const mediaPlan = mediaPlans.get(song.id)
    const resolution = await resolveOne({
      song,
      index,
      playlistTracks,
      sectionKey,
      cfg,
      dryRun,
      identityContext,
      mediaPlan,
      previewInspection: previewInspections.get(song.id),
    })
    if (mediaPlan) annotateMediaPolicy(resolution, mediaPlan)

    const ratingKey = resolution.plexRatingKey
    const ownerSongId = ratingKey ? claimedRatingKeys.get(ratingKey) : undefined
    if (ratingKey && ownerSongId !== undefined && ownerSongId !== song.id) {
      resolutions.push({
        neteaseIndex: index,
        song,
        resolution: 'needs_download',
        matchTrace: trace('dedupe_conflict', {
          conflictReason: `Plex #${ratingKey} 已明确关联网易云歌曲 ${ownerSongId}`,
          message: '同一个 Plex 媒体不能自动代表两首不同的网易云歌曲，将下载独立副本',
        }),
      })
      continue
    }
    if (ratingKey) {
      claimedRatingKeys.set(ratingKey, song.id)
      usedRatingKeys.add(ratingKey)
    }
    resolutions.push(resolution)
  }

  const extraTracks = playlistTracks.flatMap((track): ExtraTrack[] => {
    if (!track.playlistItemID || usedRatingKeys.has(track.ratingKey)) return []
    return [{
      playlistItemId: track.playlistItemID,
      ratingKey: track.ratingKey,
      title: track.title,
      artist: track.grandparentTitle || '',
      album: track.parentTitle || '',
      plexFilePaths: trackPaths(track).map(normalizePlexPath),
      protectionReason: '该 Plex 项不属于当前已验证目标，按播放列表所有权策略处理',
    }]
  })

  return { resolutions, extraTracks }
}

async function resolveOne(input: {
  song: NeteaseSong
  index: number
  playlistTracks: PlexTrack[]
  sectionKey: string
  cfg: AppConfig
  dryRun: boolean
  identityContext: IdentityContext
  mediaPlan?: MissingMediaPlan
  previewInspection?: LocalMediaInspection
}): Promise<TrackResolution> {
  const { song, index, playlistTracks, sectionKey, cfg, dryRun, identityContext, mediaPlan } = input
  const base = { neteaseIndex: index, song }
  const localAsset = mediaPlan
    ? dryRun
      ? inspectionAsset(mediaPlan.inspection)
      : persistLocalMediaInspection(mediaPlan.inspection)
    : input.previewInspection
      ? inspectionAsset(input.previewInspection)
      : resolveLocalMediaAsset(song, cfg)
  const expectedLocalPath = localAsset?.filePath ?? findExistingLocalSongPath(song, cfg)
  const expectedPlexPath = mapLocalPathToPlex(expectedLocalPath, cfg)
  const managed = localAsset?.ownership === 'managed' && localAsset.status === 'active'
  const bound = getSongIdentityBinding(song.id)

  // Explicit adoption is the only external-media identity. Verify by ratingKey
  // plus exact path, then recover by exact path if Plex changes the ratingKey.
  if (bound?.status === 'active' && bound.bindingMethod === 'manual') {
    const boundPlexPath = resolvePlexIdentityPath({
      relativePath: bound.plexRelativePath,
      currentSectionRoot: cfg.download.plexLibraryPathPrefix,
      lastObservedPath: bound.plexFilePath,
    })
    const directTrack = bound.plexRatingKey ? await getTrackByRatingKey(bound.plexRatingKey) : null
    const directPath = matchingTrackPath(directTrack, boundPlexPath)
    const recovered = directTrack && directPath
      ? [{ track: directTrack, path: directPath }]
      : await exactPathMatches(sectionKey, boundPlexPath)

    if (recovered.length === 1) {
      const { track, path } = recovered[0]!
      if (!dryRun) {
        upsertVerifiedSongIdentityBinding({
          neteaseSongId: song.id,
          plexSectionKey: sectionKey,
          plexFilePath: path,
          plexRatingKey: track.ratingKey,
          bindingMethod: 'manual',
          status: 'active',
          evidence: { source: 'explicit_adoption', verifiedBy: 'plex_file_path', ...identityContext },
        })
      }
      const playlistItemId = playlistTracks.find(item => item.ratingKey === track.ratingKey)?.playlistItemID
      return {
        ...base,
        resolution: playlistItemId ? 'matched_plex_playlist' : 'found_in_plex_library',
        plexRatingKey: track.ratingKey,
        playlistItemId,
        filePath: resolveAccessibleLocalPath(path, cfg) ?? undefined,
        matchTrace: trace('identity_binding', {
          ratingKey: track.ratingKey,
          filePath: path,
          decision: 'bound',
          identity: { method: 'manual', plexFilePath: normalizePlexPath(path), bindingStatus: 'active' },
          evidence: { kind: 'adopted' },
        }),
      }
    }

    if (!dryRun) {
      markSongIdentityBindingStale(song.id, {
        reason: recovered.length > 1 ? 'adopted_path_ambiguous' : 'adopted_media_missing',
        plexFilePath: boundPlexPath,
        conflictingRatingKeys: recovered.map(item => item.track.ratingKey),
      })
    }
    return downloadResolution(base, expectedLocalPath, localAsset, recovered.length > 1
      ? '已接管路径对应多个 Plex 媒体，无法安全选择，将下载独立副本'
      : '已接管的 Plex 媒体已失效，将下载新的托管副本')
  }

  const policyRequiresDownload = mediaPlan?.disposition === 'download_missing'
    || mediaPlan?.disposition === 'redownload_replaced'
  if (policyRequiresDownload) {
    return downloadResolution(base, mediaPlan?.filePath ?? expectedLocalPath, localAsset, mediaPlan?.message)
  }

  if (managed && expectedLocalPath && expectedPlexPath) {
    const matches = uniqueTrackPathMatches([
      ...findTrackPathMatches(playlistTracks, expectedPlexPath),
      ...(await exactPathMatches(sectionKey, expectedPlexPath)),
    ])
    if (matches.length === 1) {
      const { track, path } = matches[0]!
      if (!dryRun) {
        bindResolvedIdentity(song.id, sectionKey, track.ratingKey, path, {
          source: 'managed_exact_path',
          ownership: 'managed',
          sourceId: identityContext.sourceId,
          runId: identityContext.runId,
        })
      }
      const playlistItemId = playlistTracks.find(item => item.ratingKey === track.ratingKey)?.playlistItemID
      return {
        ...base,
        resolution: playlistItemId ? 'matched_plex_playlist' : 'found_in_plex_library',
        plexRatingKey: track.ratingKey,
        playlistItemId,
        filePath: expectedLocalPath,
        matchTrace: trace('identity_binding', {
          ratingKey: track.ratingKey,
          filePath: expectedLocalPath,
          decision: 'bound',
          identity: { method: 'path', plexFilePath: normalizePlexPath(path), bindingStatus: 'active' },
          evidence: { kind: 'managed', verifiedBy: 'exact_path' },
        }),
      }
    }
    if (matches.length > 1) {
      return {
        ...base,
        resolution: 'unavailable',
        filePath: expectedLocalPath,
        matchTrace: trace('identity_conflict', {
          filePath: expectedLocalPath,
          message: '多个 Plex 媒体指向同一个托管文件，请先在 Plex 中清理重复媒体',
          conflictReason: matches.map(item => item.track.ratingKey).join(', '),
          deletionProtectionReason: '托管路径存在多个 Plex 身份，本轮不修改播放列表',
        }),
      }
    }

    const validation = validateLocalAudioFile(expectedLocalPath)
    if (validation.valid) {
      return {
        ...base,
        resolution: 'found_on_disk',
        filePath: expectedLocalPath,
        matchTrace: trace('disk', {
          filePath: expectedLocalPath,
          message: '托管文件等待 Plex 按精确路径索引',
          evidence: { kind: 'managed', expectedPlexPath },
        }),
      }
    }
    return downloadResolution(base, expectedLocalPath, localAsset, validation.reason || '托管文件无效，将重新下载')
  }

  return downloadResolution(
    base,
    expectedLocalPath,
    localAsset,
    expectedLocalPath
      ? '发现未接管的现有文件，将下载独立托管副本'
      : '没有可验证的托管媒体或明确接管，将自动下载',
  )
}

function downloadResolution(
  base: { neteaseIndex: number; song: NeteaseSong },
  existingPath: string | null,
  asset: LocalMediaAsset | null,
  message = '需要下载托管副本',
): TrackResolution {
  const protectExternal = Boolean(existingPath && asset?.ownership !== 'managed')
  return {
    ...base,
    resolution: 'needs_download',
    mediaPolicy: {
      disposition: asset?.ownership === 'managed' && asset.status === 'replaced'
        ? 'redownload_replaced'
        : 'download_missing',
      ...(asset?.ownership === 'managed' && existingPath ? { audioPath: existingPath } : {}),
      ...(protectExternal && existingPath ? { protectedAudioPath: existingPath } : {}),
    },
    matchTrace: trace('download_required', {
      message,
      evidence: { existingPath, existingOwnership: asset?.ownership ?? null, fallback: 'managed_download' },
    }),
  }
}

function annotateMediaPolicy(resolution: TrackResolution, plan: MissingMediaPlan): void {
  resolution.mediaPolicy = {
    disposition: plan.disposition,
    ...(plan.audioPath ? { audioPath: plan.audioPath } : {}),
    ...(plan.protectedAudioPath ? { protectedAudioPath: plan.protectedAudioPath } : {}),
  }
  resolution.matchTrace = {
    ...(resolution.matchTrace ?? trace('media_policy', {})),
    evidence: {
      ...resolution.matchTrace?.evidence,
      mediaPolicy: plan.disposition,
      mediaPolicyMessage: plan.message,
    },
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

async function exactPathMatches(sectionKey: string, path: string): Promise<Array<{ track: PlexTrack; path: string }>> {
  if (!sectionKey || !path) return []
  const tracks = await findTracksByFilePath(sectionKey, path)
  return uniqueTrackPathMatches(tracks.flatMap((track) => {
    const matchedPath = matchingTrackPath(track, path)
    return matchedPath ? [{ track, path: matchedPath }] : []
  }))
}

function trackPaths(track: PlexTrack | null | undefined): string[] {
  return track?.Media?.flatMap(media => media.Part?.flatMap(part => part.file ? [part.file] : []) ?? []) ?? []
}

function matchingTrackPath(track: PlexTrack | null | undefined, expectedPath: string): string | null {
  const expected = normalizePlexPath(expectedPath)
  const exact = trackPaths(track).find(path => normalizePlexPath(path) === expected)
  if (exact) return exact
  const folded = trackPaths(track).filter(path => foldPlexPath(path) === foldPlexPath(expected))
  return new Set(folded.map(normalizePlexPath)).size === 1 ? folded[0] ?? null : null
}

function findTrackPathMatches(tracks: PlexTrack[], expectedPath: string): Array<{ track: PlexTrack; path: string }> {
  return uniqueTrackPathMatches(tracks.flatMap((track) => {
    const path = matchingTrackPath(track, expectedPath)
    return path ? [{ track, path }] : []
  }))
}

function uniqueTrackPathMatches(
  matches: Array<{ track: PlexTrack; path: string }>,
): Array<{ track: PlexTrack; path: string }> {
  const seen = new Set<string>()
  return matches.filter(({ track, path }) => {
    const key = `${track.ratingKey}\0${normalizePlexPath(path)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function trace(source: MatchTrace['source'], input: Omit<MatchTrace, 'source'>): MatchTrace {
  return { source, ...input }
}
