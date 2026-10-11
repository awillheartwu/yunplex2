import { getMediaCorrection } from './media-corrections'
import type { AppConfig } from '../config/types'
import type { JobStepContext } from '../job/types'
import type { SyncState } from '../log/types'
import type { PlaylistSource } from '../playlist/types'
import type { RunBuilder } from '../run/builder'
import {
  getPlaylistTracks,
  getTrackByRatingKey,
} from '../plex-client'
import {
  recordAppliedPlexPlaylistFingerprint,
  recordSourceObservation,
} from '../playlist/store'
import { shouldAttemptPlexRetryForResolution } from './download-diagnostics'
import {
  buildExtraTrackObservationKey,
  markExtraTrackObservationsRemoved,
  observeExtraTracks,
} from './extra-track-observation-store'
import {
  acquireIdentityMutationLock,
  applyVerifiedBindingsIfSnapshotCurrent,
  type BindingVersionSnapshot,
} from './identity-coordinator'
import {
  getSongIdentityBindingByRatingKey,
  type BindingInput,
} from './identity-store'
import {
  normalizePlexPath,
  plexPathsExactlyEqual,
} from './identity-normalization'
import type { ExtraTrack } from './lookup'
import { listPlaylistSourceTrackOccurrences } from './match-management-store'
import { resolveAccessibleLocalPath } from './path-map'
import { buildPlexReorderStepError, markPlexReorderFailures } from './reorder-failure-reporting'
import {
  buildReconciliationPlan,
  buildStrongTargetOrder,
  findExtraPlaylistOccurrences,
} from './reconciliation-plan'
import {
  PlexReorderError,
  validatePlaylistOrder,
  type ReorderMutation,
} from './reorder'
import {
  applyFullReorder,
  triggerRescan,
} from './plex-reconciler'
import {
  describePlexMatchFailure,
  inferPlexMatchFailureCause,
  type PlexMatchResult,
} from './plex-match'
import { matchTracksInPlexWithRetry } from './plex-batch-match'
import { buildPlexPlaylistFingerprint } from './playlist-fingerprint'
import type { TrackResolution } from './types'

interface PlexPlaylistIdentity {
  ratingKey: string
  title: string
}

interface ReconcilePlexPlaylistInput {
  source: PlaylistSource
  resolutions: TrackResolution[]
  extraTracks: ExtraTrack[]
  extraTaskIds: Map<number, string>
  config: AppConfig
  job: RunBuilder
  stepContext: JobStepContext
  plexPlaylist: PlexPlaylistIdentity
  sectionKey: string
  currentIdOrder: number[]
  bindingVersionSnapshot: BindingVersionSnapshot
  emptyTargetConfirmed: boolean
  skipRemoveExtra: boolean
  retryUnresolvedSnapshot: boolean
  needsPlexRefresh: boolean
  splitArtists: (artists: { name: string }[]) => [string, string]
  isCancellationRequested: () => boolean
  throwIfCancelled: () => void
  setStage: (stage: SyncState['currentStage']) => void
  log: (level: 'warn' | 'error', message: string, detail?: string) => void
}

/**
 * Reconcile concrete Plex Playlist Occurrences for one Source Convergence.
 *
 * Identity retry, occurrence-specific removal authorization, mutation and
 * readback validation stay behind one interface so no caller can reorder or
 * remove tracks without the same safety gates.
 */
export async function reconcilePlexPlaylist(
  input: ReconcilePlexPlaylistInput,
): Promise<void> {
  const {
    source,
    resolutions,
    extraTaskIds,
    config,
    job,
    stepContext,
    plexPlaylist,
    sectionKey,
    currentIdOrder,
    bindingVersionSnapshot,
    emptyTargetConfirmed,
    skipRemoveExtra,
    retryUnresolvedSnapshot,
    needsPlexRefresh,
    splitArtists,
    isCancellationRequested,
    throwIfCancelled,
    setStage,
    log,
  } = input

  const reorderStep = job.startStep('reorder', '重排 Plex 歌单', {
    context: {
      ...stepContext,
      plexPlaylistName: plexPlaylist.title || stepContext.plexPlaylistName,
      plexPlaylistRatingKey: plexPlaylist.ratingKey,
      sectionKey,
    },
  })
  setStage('updating_plex_playlist')

  if (needsPlexRefresh && sectionKey) {
    await triggerRescan(sectionKey)
    throwIfCancelled()
  }

  const plexMatchResults = new Map<number, PlexMatchResult>()
  const failedPlexRetrySongIds: number[] = []
  const pendingVerifiedBindings: BindingInput[] = []

  const retryRequests = resolutions.flatMap((resolution, index) => {
    const currentSong = getResolutionTask(job, source.id, resolution)
    const filePath = currentSong?.filePath ?? resolution.filePath
    return shouldAttemptPlexRetryForResolution(resolution.resolution, currentSong?.status, filePath)
      ? [{ key: String(index), song: resolution.song, filePath }]
      : []
  })
  const batchMatches = await matchTracksInPlexWithRetry(sectionKey, retryRequests, config,
    retryUnresolvedSnapshot ? 0 : config.sync.plexScanRetries,
    config.sync.plexScanRetryDelaySec * 1000, { throwIfCancelled })

  for (const [index, resolution] of resolutions.entries()) {
    throwIfCancelled()
    const songId = findResolutionTaskId(job, source.id, resolution)
    const currentSong = getResolutionTask(job, source.id, resolution)
    const effectiveStatus = currentSong?.status
    const effectiveFilePath = currentSong?.filePath ?? resolution.filePath
    if (effectiveFilePath && !resolution.filePath) resolution.filePath = effectiveFilePath

    if (!shouldAttemptPlexRetryForResolution(resolution.resolution, effectiveStatus, effectiveFilePath)) continue

    const result = batchMatches.get(String(index))
    if (!result) continue
    if (!result.ratingKey) {
      plexMatchResults.set(resolution.song.id, result)
      failedPlexRetrySongIds.push(resolution.song.id)
      if (songId && currentSong?.status !== 'failed_tags') {
        job.updateSong(songId, { status: 'failed_plex_match', phase: 'plex_match' })
      }
      continue
    }

    resolution.plexRatingKey = result.ratingKey
    resolution.resolution = 'found_in_plex_library'
    const indexedTrack = await getTrackByRatingKey(result.ratingKey)
    const indexedPathMatch = indexedTrack?.Media
      ?.flatMap(media => media.Part ?? [])
      .flatMap(part => part.file ? [part.file] : [])
      .map(plexPath => ({ plexPath, localPath: resolveAccessibleLocalPath(plexPath, config) }))
      .find(candidate =>
        candidate.localPath
        && effectiveFilePath
        && plexPathsExactlyEqual(candidate.localPath, effectiveFilePath),
      )
    const indexedPlexPath = indexedPathMatch?.plexPath
    const indexedLocalPath = indexedPathMatch?.localPath ?? null
    if (
      indexedPlexPath
      && effectiveFilePath
      && indexedLocalPath
      && plexPathsExactlyEqual(indexedLocalPath, effectiveFilePath)
    ) {
      pendingVerifiedBindings.push({
        neteaseSongId: resolution.song.id,
        plexSectionKey: sectionKey,
        plexFilePath: indexedPlexPath,
        plexRatingKey: result.ratingKey,
        bindingMethod: 'path',
        status: 'active',
        evidence: {
          correctionId: getMediaCorrection(resolution.song.id)?.id ?? null,
          source: 'plex_retry_exact_path',
          sourceId: source.id,
          runId: job.getId(),
          matchedBy: result.matchedBy,
          attempts: result.attempts,
          mediaPolicy: resolution.mediaPolicy?.disposition ?? null,
        },
      })
      resolution.matchTrace = {
        source: 'identity_binding',
        ratingKey: result.ratingKey,
        filePath: indexedLocalPath,
        decision: 'bound',
        identity: {
          method: 'path',
          plexFilePath: normalizePlexPath(indexedPlexPath),
          bindingStatus: 'active',
        },
        evidence: {
          mediaPolicy: resolution.mediaPolicy?.disposition,
          supersededPendingReviews: true,
        },
      }
      if (songId) {
        job.updateSong(songId, { metadata: { matchTrace: { ...resolution.matchTrace } } })
      }
    }
    if (currentSong?.status === 'pending' && songId) {
      job.updateSong(songId, {
        status: 'success',
        phase: 'done',
        filePath: effectiveFilePath ?? undefined,
      })
    }
  }

  for (const resolution of resolutions) {
    const result = plexMatchResults.get(resolution.song.id)
    if (!result) continue

    const cause = inferPlexMatchFailureCause(result)
    const songId = findResolutionTaskId(job, source.id, resolution)
    if (!songId) continue
    const currentSong = getResolutionTask(job, source.id, resolution)
    if (currentSong?.status === 'failed_tags') continue

    job.updateSong(songId, {
      error: {
        title: cause === 'library_visibility' ? 'Plex 看不到刚下载的文件' : 'Plex 未匹配到歌曲',
        message: describePlexMatchFailure(cause, config),
        stage: 'plex_match',
        songName: resolution.song.name,
        artist: splitArtists(resolution.song.artists)[0],
        context: {
          cause,
          attempts: result.attempts,
          matchedBy: result.matchedBy,
          expectedLocalPath: result.localFilePath,
          traces: result.traces,
        },
      },
    })
  }

  const currentPlaylistTracks = (await getPlaylistTracks(plexPlaylist.ratingKey, 99999))
    .filter(track => track.playlistItemID)
  const currentItems = currentPlaylistTracks.map(track => ({
    ratingKey: track.ratingKey,
    playlistItemId: track.playlistItemID!,
    observationKey: buildExtraTrackObservationKey(
      track.ratingKey,
      (track.Media ?? []).flatMap(media =>
        media.Part?.flatMap(part => part.file ? [part.file] : []) ?? [],
      ),
    ),
  }))
  const currentOccurrences = listPlaylistSourceTrackOccurrences(source.id)
  const occurrencesByPreviousRatingKey = new Map<string, typeof currentOccurrences>()
  for (const occurrence of currentOccurrences) {
    if (!occurrence.alignedPlexRatingKey) continue
    const values = occurrencesByPreviousRatingKey.get(occurrence.alignedPlexRatingKey) ?? []
    values.push(occurrence)
    occurrencesByPreviousRatingKey.set(occurrence.alignedPlexRatingKey, values)
  }

  const knownCurrentIdentities = currentItems.flatMap((item) => {
    const binding = getSongIdentityBindingByRatingKey(item.ratingKey)
    if (binding) {
      return [{ neteaseSongId: binding.neteaseSongId, plexRatingKey: binding.plexRatingKey }]
    }

    const previousCandidates = occurrencesByPreviousRatingKey.get(item.ratingKey) ?? []
    const previous = previousCandidates.length === 1 ? previousCandidates[0] : undefined
    const replacement = previous && resolutions.find(resolution =>
      resolution.neteaseIndex === previous.position
      && resolution.song.id === previous.neteaseSongId
      && resolution.plexRatingKey
      && resolution.plexRatingKey !== item.ratingKey,
    )
    if (previous && replacement) {
      return [{ neteaseSongId: previous.neteaseSongId, plexRatingKey: item.ratingKey }]
    }

    return []
  })

  const reconciliationTargets = resolutions.map(resolution => ({
    neteaseSongId: resolution.song.id,
    plexRatingKey: resolution.plexRatingKey,
    matchTrace: resolution.matchTrace,
  }))
  const strongTargetOrder = buildStrongTargetOrder(reconciliationTargets)
  const targetComplete = strongTargetOrder.length === currentIdOrder.length
  const observedExtraItems = findExtraPlaylistOccurrences(strongTargetOrder, currentItems)
  const observationItems = observedExtraItems.map((item) => {
    const track = currentPlaylistTracks.find(candidate => candidate.playlistItemID === item.playlistItemId)
    const plexFilePath = (track?.Media ?? []).flatMap(media =>
      media.Part?.flatMap(part => part.file ? [normalizePlexPath(part.file)] : []) ?? [],
    ).sort((left, right) => left.localeCompare(right))[0] ?? null
    return {
      identityKey: item.observationKey!,
      ratingKey: item.ratingKey,
      plexFilePath,
    }
  })
  const extraObservationCounts = observeExtraTracks({
    sourceId: source.id,
    playlistRatingKey: plexPlaylist.ratingKey,
    runId: job.getId(),
    targetComplete,
    items: observationItems,
  })
  const reconciliationPlan = buildReconciliationPlan({
    expectedTargetSongIds: currentIdOrder,
    targets: reconciliationTargets,
    currentItems,
    knownCurrentIdentities,
    skipRemoveExtraTracks: skipRemoveExtra,
    allowEmptyRemoval: emptyTargetConfirmed,
    extraTrackRemovalPolicy: config.sync.extraTrackRemovalPolicy,
    extraObservationCounts,
  })

  for (const decision of reconciliationPlan.removalDecisions) {
    let extraSongId = extraTaskIds.get(decision.playlistItemId)
      ?? job.findRemovedSongIdByPlaylistItemId(source.id, decision.playlistItemId)
    if (!extraSongId && !skipRemoveExtra) {
      const track = currentPlaylistTracks.find(item => item.playlistItemID === decision.playlistItemId)
      if (track) {
        extraSongId = job.addExtraSong(source.id, {
          songName: track.title,
          artist: track.grandparentTitle || '',
          album: track.parentTitle || '',
          ratingKey: track.ratingKey,
          playlistItemId: decision.playlistItemId,
          status: 'extra_skipped',
        })
        extraTaskIds.set(decision.playlistItemId, extraSongId)
      }
    }
    if (!extraSongId || decision.action !== 'preserve') continue
    job.updateSong(extraSongId, {
      status: 'extra_skipped',
      phase: 'done',
      metadata: {
        plexRatingKey: decision.ratingKey,
        plexPlaylistItemId: decision.playlistItemId,
        matchTrace: {
          decision: 'preserved',
          deletionProtectionReason: decision.reason,
        },
      },
    })
  }

  const applyConfirmedReorderMutations = (mutations: readonly ReorderMutation[]) => {
    const removedObservationKeys: string[] = []
    for (const mutation of mutations) {
      if (mutation.action !== 'remove') continue
      const observationKey = currentItems.find(
        item => item.playlistItemId === mutation.playlistItemId,
      )?.observationKey
      if (observationKey) removedObservationKeys.push(observationKey)
      const extraSongId = extraTaskIds.get(mutation.playlistItemId)
        ?? job.findRemovedSongIdByPlaylistItemId(source.id, mutation.playlistItemId)
      if (!extraSongId) continue
      job.updateSong(extraSongId, {
        status: 'removed',
        phase: 'done',
        metadata: {
          plexRatingKey: mutation.ratingKey,
          plexPlaylistItemId: mutation.playlistItemId,
          matchTrace: { decision: 'removed' },
        },
      })
    }
    if (removedObservationKeys.length > 0) {
      markExtraTrackObservationsRemoved(
        source.id,
        plexPlaylist.ratingKey,
        job.getId(),
        removedObservationKeys,
      )
    }
  }

  let releaseIdentityLock: (() => void) | null = null
  try {
    releaseIdentityLock = await acquireIdentityMutationLock()
    const currentBindings = applyVerifiedBindingsIfSnapshotCurrent(
      bindingVersionSnapshot,
      pendingVerifiedBindings,
    )
    assertResolvedIdentitiesCurrent(resolutions, currentBindings)

    const reorderResult = await applyFullReorder(
      plexPlaylist.ratingKey,
      reconciliationPlan.targetOrder,
      currentItems,
      sectionKey,
      isCancellationRequested,
      (level, message) => log(level, message),
      {
        authorizedRemovalItemIds: reconciliationPlan.authorizedRemovalItemIds,
        removalProtectionReason: reconciliationPlan.hasIncompleteTargetOrder
          ? '目标歌单尚有未建立强身份的歌曲'
          : '缺少可审计的旧身份',
      },
    )
    applyConfirmedReorderMutations(reorderResult.mutations)
    const postPlaylistTracks = await getPlaylistTracks(plexPlaylist.ratingKey, 99999)
    const postItems = postPlaylistTracks
      .filter(track => track.playlistItemID)
      .map(track => ({ ratingKey: track.ratingKey, playlistItemId: track.playlistItemID! }))
    const orderValidation = validatePlaylistOrder(reconciliationPlan.targetOrder, postItems, {
      allowExtra: reconciliationPlan.allowExtra,
    })
    if (!orderValidation.ok) {
      job.failStep(reorderStep, 'Plex 歌单重排校验失败', {
        title: 'Plex 歌单重排校验失败',
        message: 'Plex 写入完成后，实际歌单顺序与目标顺序不一致',
        stage: 'plex_insert',
        context: { ...orderValidation },
      })
      throw new Error('Plex 歌单重排校验失败')
    }
    recordAppliedPlexPlaylistFingerprint(
      source.id,
      buildPlexPlaylistFingerprint(postPlaylistTracks),
    )
  } catch (error) {
    if (error instanceof PlexReorderError) {
      applyConfirmedReorderMutations(error.result.mutations)
      const ratingKeyToSongId = new Map<string, string>()
      for (const resolution of resolutions) {
        if (!resolution.plexRatingKey) continue
        const taskSongId = findResolutionTaskId(job, source.id, resolution)
        if (taskSongId) ratingKeyToSongId.set(resolution.plexRatingKey, taskSongId)
      }

      const playlistItemIdToRemovedSongId = new Map<number, string>()
      for (const item of currentItems) {
        const removedSongId = extraTaskIds.get(item.playlistItemId)
          ?? job.findRemovedSongIdByPlaylistItemId(source.id, item.playlistItemId)
        if (removedSongId) {
          playlistItemIdToRemovedSongId.set(item.playlistItemId, removedSongId)
        }
      }
      markPlexReorderFailures(job, error.result.failures, {
        ratingKeyToSongId,
        playlistItemIdToRatingKey: new Map(
          currentItems.map(item => [item.playlistItemId, item.ratingKey]),
        ),
        playlistItemIdToRemovedSongId,
      })
      job.failStep(reorderStep, 'Plex 歌单重排失败', buildPlexReorderStepError(error))
    }

    try {
      const partialTracks = await getPlaylistTracks(plexPlaylist.ratingKey, 99999)
      recordSourceObservation(source.id, {
        plexFingerprint: buildPlexPlaylistFingerprint(partialTracks),
      })
    } catch {
      // Preserve and report the original mutation failure.
    }
    throw error
  } finally {
    releaseIdentityLock?.()
  }

  throwIfCancelled()
  job.finishStep(reorderStep, 'success', 'Plex 歌单重排完成')
}

/**
 * Final identity gate immediately before Plex mutation. The caller holds the
 * identity lock, so any mismatch means this convergence was planned against a
 * stale identity snapshot and must not reorder or remove occurrences.
 */
export function assertResolvedIdentitiesCurrent(
  resolutions: readonly TrackResolution[],
  currentBindings: ReadonlyMap<number, { plexRatingKey: string | null }>,
): void {
  for (const resolution of resolutions) {
    if (!resolution.plexRatingKey) continue
    const binding = currentBindings.get(resolution.song.id)
    if (binding && binding.plexRatingKey !== resolution.plexRatingKey) {
      throw new Error(`歌曲 #${resolution.song.id} 的身份已变化，本轮已安全中止 Plex 写入和删除，请重试同步`)
    }
  }
}

function findResolutionTaskId(
  job: RunBuilder,
  sourceId: string,
  resolution: TrackResolution,
): string | undefined {
  return job.findSongIdByIndex(sourceId, resolution.neteaseIndex)
    ?? job.findSongId(sourceId, resolution.song.id)
}

function getResolutionTask(
  job: RunBuilder,
  sourceId: string,
  resolution: TrackResolution,
) {
  return job.getSongByIndex(sourceId, resolution.neteaseIndex)
    ?? job.getSong(sourceId, resolution.song.id)
}
