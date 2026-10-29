import type { PlaylistWriteProgress } from '../../../shared/playlist-write'
import { playlistIdentityValidator } from './playlist-write-identity'
import { ensureSourcePlaylistTarget } from './source-playlist-target'
import { assertPlaylistWriteContext, playlistServerScope } from './playlist-write-state'
import { playlistWriteItems } from './playlist-write-snapshot'
import { beginPlaylistSongConfirmation } from './playlist-song-outcomes'
import { getMediaCorrection } from './media-corrections'
import { openPlexScanEvents } from '../plex-scan-events'
import type { AppConfig } from '../config/types'
import type { JobStepContext } from '../job/types'
import type { SyncState } from '../log/types'
import type { PlaylistSource } from '../playlist/types'
import type { RunBuilder } from '../run/builder'
import {
  getPlaylistWriteTracks,
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
  assertBindingVersionsUnchanged,
  assertBindingRatingKeysUnchanged,
  type BindingVersionSnapshot,
} from './identity-coordinator'
import {
  getSongIdentityBindingsByRatingKey,
  type BindingInput,
} from './identity-store'
import {
  normalizePlexPath,
  plexPathsExactlyEqual,
} from './identity-normalization'
import { listPlaylistSourceTrackOccurrences } from './match-management-store'
import { resolveAccessibleLocalPath } from './path-map'
import { buildPlexReorderStepError, markPlexReorderFailures } from './reorder-failure-reporting'
import {
  buildReconciliationPlan,
  buildStrongTargetOrder,
  findExtraPlaylistOccurrences,
  hasCompleteTargetIdentities,
} from './reconciliation-plan'
import {
  PlexReorderError,
  PlexReorderCancelledError,
  createPlaylistOrderError,
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
import {
  buildPlexPathSnapshot,
  buildPlexPlaylistFingerprint,
} from './playlist-fingerprint'
import type { ReadonlyTrackResolution, TrackResolution } from './types'
import { getSourceFailurePolicy, observePlexRemovalFailures, resolveSupersededPlexRemovals } from './failure-policy'
import { confirmPlaylistItemAbsent, confirmPlaylistReconciled } from '../tasks/completion'
import { failureSubjectKey } from '../tasks/failure-identity'
import { captureSourceConvergenceCheckpoint, type SourceConvergenceCheckpoint } from './source-checkpoint'

interface PlexPlaylistIdentity {
  ratingKey: string
  title: string
}

interface ReconcilePlexPlaylistInput {
  source: PlaylistSource
  resolutions: readonly ReadonlyTrackResolution[]
  extraTaskIds: ReadonlyMap<number, string>
  config: AppConfig
  job: RunBuilder
  stepContext: JobStepContext
  plexPlaylist: PlexPlaylistIdentity
  sectionKey: string
  currentIdOrder: number[]
  bindingVersionSnapshot: BindingVersionSnapshot
  bindingRatingKeys: ReadonlyMap<number, string | null>
  emptyTargetConfirmed: boolean
  skipRemoveExtra: boolean
  retryUnresolvedSnapshot: boolean
  needsPlexRefresh: boolean
  expectedPlexFingerprint?: string
  assertRecoveryContextUnchanged?: () => void
  splitArtists: (artists: { name: string }[]) => [string, string]
  isCancellationRequested: () => boolean
  throwIfCancelled: () => void
  setStage: (stage: SyncState['currentStage']) => void
  onProgress?: (value: PlaylistWriteProgress) => void
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
): Promise<SourceConvergenceCheckpoint> {
  const {
    source,
    resolutions: downloadedResolutions,
    extraTaskIds: previousExtraTaskIds,
    config,
    job,
    stepContext,
    plexPlaylist,
    sectionKey,
    currentIdOrder,
    bindingVersionSnapshot,
    bindingRatingKeys,
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
  // This terminal stage owns its resolution entries and run-item lookup.
  // Song metadata remains shared; matchTrace is replaced when identity changes.
  const resolutions = downloadedResolutions.map(resolution => ({ ...resolution }))
  const extraTaskIds = new Map(previousExtraTaskIds)
  const retryStatuses = new Map(job.getRun().songs.map(song => [song.id, song.status]))
  const outcomes = beginPlaylistSongConfirmation(job, source.id)
  try {

  const reorderContext = { ...stepContext, plexPlaylistName: plexPlaylist.title || stepContext.plexPlaylistName,
    plexPlaylistRatingKey: plexPlaylist.ratingKey, sectionKey }
  const reorderStep = job.startStep('reorder', '核对 Plex 媒体并更新歌单', { context: reorderContext })
  let createdCount = 0
  const onProgress = (value: PlaylistWriteProgress) => {
    job.updateStepProgress(reorderStep, value)
    if (value.phase === 'creating') createdCount = value.confirmed
    input.onProgress?.(value)
  }
  setStage('refreshing_plex')

  const plexMatchResults = new Map<number, PlexMatchResult>()
  const failedPlexRetrySongIds: number[] = []
  const pendingVerifiedBindings: BindingInput[] = []

  const retryRequests = resolutions.flatMap((resolution, index) => {
    const currentSong = getResolutionTask(job, source.id, resolution)
    const filePath = currentSong?.filePath ?? resolution.filePath
    return shouldAttemptPlexRetryForResolution(resolution.resolution,
      currentSong ? retryStatuses.get(currentSong.id) ?? currentSong.status : undefined, filePath)
      ? [{ key: String(index), song: resolution.song, filePath }]
      : []
  })
  const needsScan = Boolean(needsPlexRefresh && sectionKey)
  const scanEvents = needsScan ? await openPlexScanEvents(config.plex, sectionKey) : undefined
  let batchMatches: Map<string, PlexMatchResult>
  try {
    if (scanEvents && !scanEvents.getState().connected) log('warn', 'Plex 扫描事件未连接，继续轮询扫描状态与文件路径')
    const scanRequest = needsScan ? await triggerRescan(sectionKey) : undefined
    if (scanRequest) scanEvents?.setActivityId(scanRequest.activityId, scanRequest.requestedAt)
    throwIfCancelled()
    batchMatches = await matchTracksInPlexWithRetry(sectionKey, retryRequests, config,
      retryUnresolvedSnapshot && !scanRequest ? 0 : config.sync.plexScanRetries,
      config.sync.plexScanRetryDelaySec * 1000, { throwIfCancelled, scanRequest, scanEvents })
  } finally { await scanEvents?.close() }

  for (const [index, resolution] of resolutions.entries()) {
    throwIfCancelled()
    const songId = findResolutionTaskId(job, source.id, resolution)
    const currentSong = getResolutionTask(job, source.id, resolution)
    const effectiveStatus = currentSong ? retryStatuses.get(currentSong.id) ?? currentSong.status : undefined
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
        title: cause === 'scan_timeout' ? '等待 Plex 索引超时' : cause === 'library_visibility' ? 'Plex 尚未索引托管文件' : 'Plex 未匹配到歌曲',
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
          scan: result.scan,
        },
      },
    })
  }

  setStage('updating_plex_playlist')
  const releaseBoundary = await acquireIdentityMutationLock()
  try {
    const currentBindings = applyVerifiedBindingsIfSnapshotCurrent(bindingVersionSnapshot, pendingVerifiedBindings, bindingRatingKeys)
    assertResolvedIdentitiesCurrent(resolutions, currentBindings)
    const writeIdentity = captureSourceConvergenceCheckpoint(currentIdOrder)
    const owner = {
      sourceId: source.id, scope: playlistServerScope(config),
      assertCurrent: () => {
        throwIfCancelled()
        assertPlaylistWriteContext(source, config)
        assertBindingVersionsUnchanged(writeIdentity.bindings)
        assertBindingRatingKeysUnchanged(writeIdentity.plexRatingKeys)
        input.assertRecoveryContextUnchanged?.()
      },
      ...playlistIdentityValidator(currentBindings, config),
    }
    owner.assertCurrent()
    await ensureSourcePlaylistTarget({ source, config, playlist: plexPlaylist,
      targets: buildStrongTargetOrder(resolutions.map(resolution => ({ neteaseSongId: resolution.song.id,
        plexRatingKey: resolution.plexRatingKey, matchTrace: resolution.matchTrace }))), context: stepContext, owner, onProgress,
      onTarget: key => job.updateStepContext(reorderStep, { plexPlaylistRatingKey: key }) })
    reorderContext.plexPlaylistRatingKey = plexPlaylist.ratingKey
    if (!plexPlaylist.ratingKey) {
      job.finishStep(reorderStep, 'skipped', '尚无具备强身份的目标媒体，未创建 Plex 歌单')
      return captureSourceConvergenceCheckpoint(currentIdOrder)
    }
  const currentPlaylistTracks = await getPlaylistWriteTracks(plexPlaylist.ratingKey)
  owner.assertCurrent()
  owner.validateTracks(currentPlaylistTracks)
  const occurrenceItems = playlistWriteItems(currentPlaylistTracks)
  if (input.expectedPlexFingerprint && buildPlexPlaylistFingerprint(currentPlaylistTracks) !== input.expectedPlexFingerprint) {
    throw new Error('Plex 歌单在索引恢复期间被修改，本轮未执行歌单写入，请正常同步')
  }
  const currentItems = currentPlaylistTracks.map(track => ({
    ratingKey: track.ratingKey,
    playlistItemId: track.playlistItemID!,
    filePaths: occurrenceItems.find(item => item.playlistItemId === track.playlistItemID)!.filePaths,
    observationKey: buildExtraTrackObservationKey(
      track.ratingKey,
      (track.Media ?? []).flatMap(media =>
        media.Part?.flatMap(part => part.file ? [part.file] : []) ?? [],
      ),
    ),
  }))
  const ignoredRemovalItemIds = observePlexRemovalFailures({
    sourceId: source.id, playlistRatingKey: plexPlaylist.ratingKey,
    currentItemIds: new Set(currentItems.map(item => item.playlistItemId)),
    maxFailureAttempts: config.sync.maxFailureAttempts,
  })
  const currentOccurrences = listPlaylistSourceTrackOccurrences(source.id)
  const removalProblems = getSourceFailurePolicy(source.id).removalFailures
  const occurrencesByPreviousRatingKey = new Map<string, typeof currentOccurrences>()
  for (const occurrence of currentOccurrences) {
    if (!occurrence.alignedPlexRatingKey) continue
    const values = occurrencesByPreviousRatingKey.get(occurrence.alignedPlexRatingKey) ?? []
    values.push(occurrence)
    occurrencesByPreviousRatingKey.set(occurrence.alignedPlexRatingKey, values)
  }

  const knownCurrentIdentities = currentItems.flatMap((item) => {
    const bindings = getSongIdentityBindingsByRatingKey(item.ratingKey)
    if (bindings.length) {
      return bindings.map(binding => ({ neteaseSongId: binding.neteaseSongId, plexRatingKey: binding.plexRatingKey }))
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
  const targetComplete = hasCompleteTargetIdentities(reconciliationTargets, currentIdOrder)
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
    ignoredRemovalItemIds,
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
          playlistRatingKey: plexPlaylist.ratingKey,
          status: 'extra_skipped',
        })
        extraTaskIds.set(decision.playlistItemId, extraSongId)
      }
    }
    if (!extraSongId || decision.action !== 'preserve') continue
    job.updateSong(extraSongId, {
      status: ignoredRemovalItemIds.has(decision.playlistItemId)
        ? removalProblems[failureSubjectKey({ sourceId: source.id, songName: '',
          plexPlaylistRatingKey: plexPlaylist.ratingKey, plexPlaylistItemId: decision.playlistItemId })]?.status === 'ignored'
          ? 'ignored_failure' : 'awaiting_retry'
        : 'extra_skipped',
      phase: 'done',
      metadata: {
        plexRatingKey: decision.ratingKey,
        plexPlaylistItemId: decision.playlistItemId,
        plexPlaylistRatingKey: plexPlaylist.ratingKey,
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
      confirmPlaylistItemAbsent(source.id, { plexPlaylistRatingKey: plexPlaylist.ratingKey,
        plexPlaylistItemId: mutation.playlistItemId })
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
          plexPlaylistRatingKey: plexPlaylist.ratingKey,
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


  let checkpoint: SourceConvergenceCheckpoint | undefined
  let mutationSummary = ''
  try {
    owner.assertCurrent()
    input.assertRecoveryContextUnchanged?.()
    if (input.expectedPlexFingerprint) {
      const writeSnapshot = await getPlaylistWriteTracks(plexPlaylist.ratingKey)
      if (buildPlexPlaylistFingerprint(writeSnapshot) !== input.expectedPlexFingerprint) {
        throw new Error('Plex 歌单在索引恢复期间被修改，本轮未执行歌单写入，请正常同步')
      }
      input.assertRecoveryContextUnchanged?.()
    }
    const reorderResult = await applyFullReorder(
      plexPlaylist.ratingKey,
      reconciliationPlan.targetOrder,
      currentItems,
      sectionKey,
      isCancellationRequested,
      (level, message) => log(level, message),
      {
        owner, onProgress,
        onConfirmed: applyConfirmedReorderMutations,
        authorizedRemovalItemIds: reconciliationPlan.authorizedRemovalItemIds,
        removalProtectionReason: reconciliationPlan.hasIncompleteTargetOrder
          ? '目标歌单尚有未建立强身份的歌曲'
          : '缺少可审计的旧身份',
      },
    )
    mutationSummary = `新增 ${createdCount + reorderResult.inserted} 项，调序 ${reorderResult.moved} 项，移除 ${reorderResult.removed} 项`
    const postPlaylistTracks = await getPlaylistWriteTracks(plexPlaylist.ratingKey)
    owner.assertCurrent()
    owner.validateTracks(postPlaylistTracks)
    const postItems = playlistWriteItems(postPlaylistTracks)
    const orderValidation = validatePlaylistOrder(reconciliationPlan.targetOrder, postItems, {
      allowExtra: reconciliationPlan.allowExtra,
    })
    if (!orderValidation.ok) {
      throw createPlaylistOrderError(orderValidation, postItems, reorderResult)
    }
    const extraItemIds = new Set(findExtraPlaylistOccurrences(reconciliationPlan.targetOrder, postItems).map(item => item.playlistItemId))
    resolveSupersededPlexRemovals({ sourceId: source.id, playlistRatingKey: plexPlaylist.ratingKey,
      retainedItemIds: new Set(postItems.filter(item => !extraItemIds.has(item.playlistItemId)).map(item => item.playlistItemId)) })
    confirmPlaylistReconciled(source.id, { items: postItems, targets: resolutions.flatMap(resolution =>
      resolution.plexRatingKey && resolution.resolution !== 'ignored_failure'
        ? [{ songId: resolution.song.id, songName: resolution.song.name, ratingKey: resolution.plexRatingKey }] : []) })
    recordAppliedPlexPlaylistFingerprint(
      source.id,
      buildPlexPlaylistFingerprint(postPlaylistTracks),
      undefined,
      buildPlexPathSnapshot(postPlaylistTracks),
    )
    const confirmedKeys = new Set(reconciliationPlan.targetOrder)
    outcomes.confirm(resolutions.flatMap(resolution => resolution.plexRatingKey && confirmedKeys.has(resolution.plexRatingKey)
      ? [findResolutionTaskId(job, source.id, resolution)].filter((id): id is string => Boolean(id)) : []))
    checkpoint = captureSourceConvergenceCheckpoint(currentIdOrder)
  } catch (error) {
    if (error instanceof PlexReorderCancelledError) {
      throw error
    }
    if (error instanceof PlexReorderError) {
        const ratingKeyToSongIds = new Map<string, string[]>()
      for (const resolution of resolutions) {
        if (!resolution.plexRatingKey) continue
        const taskSongId = findResolutionTaskId(job, source.id, resolution)
        if (taskSongId) {
          const songIds = ratingKeyToSongIds.get(resolution.plexRatingKey) ?? []
          songIds.push(taskSongId)
          ratingKeyToSongIds.set(resolution.plexRatingKey, songIds)
        }
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
        ratingKeyToSongIds,
        playlistItemIdToRatingKey: new Map(
          currentItems.map(item => [item.playlistItemId, item.ratingKey]),
        ),
        playlistItemIdToRemovedSongId,
      })
      job.failStep(reorderStep, 'Plex 歌单重排失败', buildPlexReorderStepError(error))
    }

    try {
      const partialTracks = await getPlaylistWriteTracks(plexPlaylist.ratingKey)
      recordSourceObservation(source.id, {
        plexFingerprint: buildPlexPlaylistFingerprint(partialTracks),
        plexPaths: buildPlexPathSnapshot(partialTracks),
      })
    } catch {
      // Preserve and report the original mutation failure.
    }
    throw error
  }

  throwIfCancelled()
  const resolvedCount = reconciliationTargets.filter(target => target.plexRatingKey
    && target.matchTrace?.identity?.bindingStatus === 'active'
    && ['path', 'manual'].includes(target.matchTrace.identity.method)).length
  const sharedCount = resolvedCount - strongTargetOrder.length
  const completionMessage = sharedCount > 0
    ? `Plex 歌单重排完成，${resolvedCount} 首来源歌曲对应 ${strongTargetOrder.length} 个 Plex 媒体，${sharedCount} 首共用已有媒体`
    : 'Plex 歌单重排完成'
  job.finishStep(reorderStep, 'success', `${completionMessage}；${mutationSummary}`)
  return checkpoint!
  } finally { releaseBoundary() }
  } catch (error) {
    outcomes.defer(error)
    throw error
  } finally { outcomes.defer() }
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
