import type { AppConfig } from '../config/types'
import {
  getPlexTrackMusicBrainzIdentity,
  getPlexTrackNeteaseIdentity,
  getTrackByRatingKey,
  type PlexTrack,
} from '../plex-client'
import type { NeteaseSong } from '../netease'
import { resolveMusicBrainzIdToRecording, resolveRecording } from '../integrations/musicbrainz'
import type { TrackResolution } from './types'
import { createMatchReview, findRejectedMatchReview } from './identity-store'
import { normalizePlexPath } from './identity-normalization'
import { resolveAccessibleLocalPath } from './path-map'
import { evaluateNeteaseProviderIdentity } from './provider-identity'
import { resolveSongArtistCandidateNames } from './song-artist-candidates'
import { bindResolvedIdentity } from './lookup-identity'

type ReviewCandidate = PlexTrack | {
  ratingKey: string
  title: string
  grandparentTitle: string
  parentTitle: string
  playlistItemID?: number
}

/**
 * Turn weak Plex evidence into either a strong provider/recording identity or
 * a persisted review. Keeping this policy together prevents callers from
 * accidentally skipping the review and deletion-protection semantics.
 */
export async function resolveReviewCandidate(
  base: Omit<TrackResolution, 'resolution'>,
  song: NeteaseSong,
  candidate: ReviewCandidate,
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

  const durationToleranceMs = 2000
  const automaticBindingAllowed = additionalEvidence.automaticBindingAllowed !== false
  const providerIdentity = getPlexTrackNeteaseIdentity(fullCandidate)
  const providerEvidence = providerIdentity
    ? evaluateNeteaseProviderIdentity(song, fullCandidate, providerIdentity, durationToleranceMs)
    : null
  if (automaticBindingAllowed && plexPath && providerEvidence?.matched) {
    if (!dryRun) {
      bindResolvedIdentity(song.id, sectionKey, fullCandidate.ratingKey, plexPath, undefined, 'provider_guid', {
        source: 'plex_netease_provider',
        reason,
        neteaseProviderEvidence: providerEvidence,
      })
    }
    const playlistItemId = candidate.playlistItemID
    return {
      ...base,
      resolution: playlistItemId ? 'matched_plex_playlist' : 'found_in_plex_library',
      plexRatingKey: fullCandidate.ratingKey,
      playlistItemId,
      filePath: resolveAccessibleLocalPath(plexPath, cfg) ?? undefined,
      matchTrace: {
        source: 'provider_identity',
        ratingKey: fullCandidate.ratingKey,
        filePath: resolveAccessibleLocalPath(plexPath, cfg) ?? undefined,
        titleMatched: true,
        artistMatched: true,
        albumMatched: true,
        decision: 'bound',
        identity: {
          method: 'provider_guid',
          plexFilePath: normalizePlexPath(plexPath),
          mbRecordingId: null,
          bindingStatus: 'active',
        },
      },
    }
  }

  const plexMusicBrainzIdentity = getPlexTrackMusicBrainzIdentity(fullCandidate)
  const resolvedArtistNames = cfg.other?.enableMusicBrainzResolver
    ? await resolveSongArtistCandidateNames(song.artists)
    : song.artists.map(artist => artist.name)
  const durationOptions = { durationMs: song.dt, durationToleranceMs }
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
      durationOptions,
    )
    desiredRecordingId = desiredRecordingEvidence?.id ?? null
    if (!candidateRecordingId && plexMusicBrainzIdentity.untypedIds.length > 0) {
      for (const untypedId of plexMusicBrainzIdentity.untypedIds) {
        plexIdMappings.push(await resolveMusicBrainzIdToRecording(untypedId))
      }
      const mappedIds = [...new Set(plexIdMappings
        .filter(mapping => mapping.status === 'success' && mapping.recordingId)
        .map(mapping => mapping.recordingId!))]
      if (plexIdMappings.every(mapping => mapping.status === 'success') && mappedIds.length === 1) {
        candidateRecordingId = mappedIds[0]!
      }
    }
    if (!candidateRecordingId && plexMusicBrainzIdentity.untypedIds.length === 0) {
      candidateRecordingEvidence = await resolveRecording(
        fullCandidate.title,
        resolvedArtistNames,
        fullCandidate.parentTitle || '',
        {
          durationMs: 'duration' in fullCandidate && typeof fullCandidate.duration === 'number'
            ? fullCandidate.duration
            : song.dt,
          durationToleranceMs,
        },
      )
      candidateRecordingId = candidateRecordingEvidence?.id ?? null
    }
    if (automaticBindingAllowed && desiredRecordingId && candidateRecordingId === desiredRecordingId) {
      if (!dryRun) {
        bindResolvedIdentity(song.id, sectionKey, fullCandidate.ratingKey, plexPath, desiredRecordingId, 'mb_recording', {
          source: 'musicbrainz_recording',
          reason,
          desiredRecordingId,
          candidateRecordingId,
          desiredRecordingEvidence,
          candidateRecordingEvidence,
          plexMusicBrainzIdentity,
          plexIdMappings,
        })
      }
      const playlistItemId = candidate.playlistItemID
      return {
        ...base,
        resolution: playlistItemId ? 'matched_plex_playlist' : 'found_in_plex_library',
        plexRatingKey: fullCandidate.ratingKey,
        playlistItemId,
        filePath: resolveAccessibleLocalPath(plexPath, cfg) ?? undefined,
        matchTrace: {
          source: 'mb_recording_migration',
          ratingKey: fullCandidate.ratingKey,
          filePath: resolveAccessibleLocalPath(plexPath, cfg) ?? undefined,
          decision: 'migrated',
          identity: {
            method: 'mb_recording',
            plexFilePath: normalizePlexPath(plexPath),
            mbRecordingId: desiredRecordingId,
            bindingStatus: 'active',
          },
        },
      }
    }
  }

  const review = dryRun ? null : createMatchReview({
    neteaseSongId: song.id,
    sourceId: context.sourceId,
    runId: context.runId,
    candidatePlexFilePath: plexPath,
    candidatePlexRatingKey: fullCandidate.ratingKey,
    candidateMbRecordingId: candidateRecordingId,
    evidence: {
      ...additionalEvidence,
      reason,
      desired: {
        title: song.name,
        artists: song.artists.map(item => item.name),
        album: song.album.name,
        mbRecordingId: desiredRecordingId,
      },
      candidate: {
        title: fullCandidate.title,
        artist: fullCandidate.grandparentTitle,
        album: fullCandidate.parentTitle,
        mbRecordingId: candidateRecordingId,
      },
      musicBrainz: {
        desired: desiredRecordingEvidence,
        candidate: candidateRecordingEvidence,
        plexIdentity: plexMusicBrainzIdentity,
        plexIdMappings,
      },
      neteaseProviderIdentity: providerEvidence,
    },
  })
  return {
    ...base,
    resolution: 'needs_review',
    matchTrace: {
      source: 'pending_review',
      ratingKey: fullCandidate.ratingKey,
      filePath: plexPath ? resolveAccessibleLocalPath(plexPath, cfg) ?? undefined : undefined,
      message: reason,
      decision: 'pending_review',
      deletionProtectionReason: '存在未确认的 Plex 匹配候选，已保留旧歌单项',
      evidence: additionalEvidence,
      candidate: {
        plexFilePath: plexPath,
        ratingKey: fullCandidate.ratingKey,
        mbRecordingId: candidateRecordingId,
        reviewId: review?.id,
      },
    },
  }
}

function trackPath(track: ReviewCandidate | null | undefined): string | null {
  if (!track || !('Media' in track)) return null
  return track.Media?.flatMap(media =>
    media.Part?.map(part => part.file).filter((file): file is string => Boolean(file)) ?? [],
  )[0] ?? null
}
