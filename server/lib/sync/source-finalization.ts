import type { RunBuilder } from '../run/builder'
import type { JobStepContext } from '../job/types'
import { describeDomainError } from '../domain-error'
import { getPlaylistUpdatedAt } from '../plex-client'
import { recordSourceComparison, updateSource } from '../playlist/store'
import type { AppConfig } from '../config/types'
import type { PlaylistSource } from '../playlist/types'
import { recordPlaylistAlignmentValidation, recordPlaylistOccurrenceSyncResult, type PlaylistAlignmentValidationInput } from './match-management-store'
import { isAwaitingManualSongStatus } from '../../../lib/media-status-projection'
import { hasActiveMediaCorrectionsForSource } from './media-corrections'
import { recordFailure } from '../tasks/failure-records'
import { confirmSongIdentity, confirmSourceConvergenceCompleted } from '../tasks/completion'
import { isFailedSongStatus } from '../../../lib/task-status'
import { PlexReorderError } from './reorder'
import { pauseDownloadQueue } from '../download/queue-control'
import type { MatchTrace } from './types'
import type { BindingVersionSnapshot } from './identity-coordinator'
import { sourceConvergenceCheckpointIsCurrent, type SourceConvergenceCheckpoint } from './source-checkpoint'
import { pendingPlaylistWrite } from './playlist-write-state'

interface PlexPlaylistIdentity {
  ratingKey: string
}

export function recordSourceConvergenceFailure(input: {
  source: PlaylistSource
  job: RunBuilder
  context: JobStepContext
  error: unknown
  stage: string
  dryRun: boolean
  authoritativeTrackCount?: number
}): SourceConvergenceResult {
  const { source, job, context, error, stage, dryRun } = input
  const sourceSteps = job.getRun().steps.filter(step => step.context?.sourceId === source.id)
  const stepCode = sourceSteps.filter(step => step.status === 'failed').at(-1)?.error?.code
  const cause = describeDomainError(error, stepCode ?? (stage.includes('plex') || stage === 'reorder' ? 'failed_plex_insert' : 'unknown_error'))
  const message = cause.diagnostic ?? '未知错误'
  const sourceSongs = job.getRun().songs.filter(song => song.sourceId === source.id)
  const failedSongs = sourceSongs.filter(song => isFailedSongStatus(song.status))
  const songWriteFailure = error instanceof PlexReorderError
    && failedSongs.some(song => song.status === 'failed_plex_insert')
  const status = songWriteFailure && sourceSongs.some(song => ['success', 'skipped_existing'].includes(song.status))
    ? 'partial' : 'failed'
  const activeStep = sourceSteps.find(step => step.status === 'running')
  if (activeStep || !sourceSteps.some(step => step.status === 'failed' && step.error?.message === message)) {
    const stepId = activeStep?.id ?? job.startStep('source_error', '来源同步失败', { context })
    job.failStep(stepId, cause.label, {
      title: cause.label,
      message,
      stage,
      code: cause.code,
    })
  }
  if (!dryRun) {
    if (cause.code === 'authentication_failed') pauseDownloadQueue('authentication', cause.userMessage)
    if (songWriteFailure) {
      // Concrete song failures own their retry budgets; the run keeps the aggregate diagnostic.
      recordSourceSongResults(source.id, job)
    } else {
      recordFailure({ sourceId: source.id, sourceName: source.name, songName: '来源同步',
        runId: job.getId(), runType: 'sync', failureKind: cause.code, failureReason: message })
    }
    updateSource(source.id, {
      lastSyncedAt: new Date().toISOString(),
      lastStatus: status,
      lastError: message,
      lastJobId: job.getId(),
      requiresMatchReconcile: true,
      ...(input.authoritativeTrackCount === undefined ? {} : { trackCount: input.authoritativeTrackCount }),
    })
  }
  return { kind: 'failed', status, failedSongs: songWriteFailure ? failedSongs.length : 1, summary: message }
}

interface SourceResultSummary {
  status: 'success' | 'partial' | 'failed'
  failedSongs: number
  summary: string
}

export type SourceConvergenceResult =
  | (SourceResultSummary & { kind: 'completed' })
  | (SourceResultSummary & { kind: 'failed'; status: 'partial' | 'failed' })
  | (SourceResultSummary & { kind: 'deferred'; reason: 'superseded'; status: 'partial' })

interface FinalizeSourceConvergenceInput {
  source: PlaylistSource
  config: AppConfig
  checkpoint: SourceConvergenceCheckpoint
  job: RunBuilder
  dryRun: boolean
  fullVerification: boolean
  skipRemoveExtra: boolean
  authoritativeTrackCount: number
  currentIdOrder: number[]
  trackUpdateTime: number | null
  plexUpdatedAt: number | null
  plexPlaylist: PlexPlaylistIdentity | null | undefined
  neteaseCursor?: string
  verifiedPlaylistItems?: PlaylistAlignmentValidationInput['playlistItems']
}

/**
 * Commit the durable result of one Source Convergence.
 *
 * Run-song outcomes are the single input to source status. The finalized run
 * is projected into failure_records by saveSyncRun, outside this source update.
 */
export async function finalizeSourceConvergence(
  input: FinalizeSourceConvergenceInput,
): Promise<SourceConvergenceResult> {
  const {
    source,
    job,
    dryRun,
    fullVerification,
    skipRemoveExtra,
    authoritativeTrackCount,
    currentIdOrder,
    trackUpdateTime,
    plexUpdatedAt,
    plexPlaylist,
  } = input
  const sourceSongs = job.getRun().songs.filter(song => song.sourceId === source.id)
  const succCount = sourceSongs.filter(song => song.status === 'success').length
  const existingCount = sourceSongs.filter(song => song.status === 'skipped_existing').length
  const resolvedTargetCount = succCount + existingCount
  const failCount = sourceSongs.filter(song =>
    ['failed_download', 'failed_tags', 'failed_plex_match', 'failed_plex_insert'].includes(song.status),
  ).length
  const restrictedCount = sourceSongs.filter(song => song.status === 'copyright_restricted').length
  const ignoredCount = sourceSongs.filter(song => song.status === 'ignored_failure').length
  const deferredCount = sourceSongs.filter(song => song.status === 'awaiting_retry').length
  const preservedExtraCount = sourceSongs.filter(song => song.status === 'extra_skipped').length
  const awaitingManualCount = sourceSongs.filter(song => isAwaitingManualSongStatus(song.status)).length

  let sourceStatus: PlaylistSource['lastStatus'] = 'success'
  if (failCount > 0 && resolvedTargetCount === 0) {
    sourceStatus = 'failed'
  } else if (
    failCount > 0
    || ignoredCount > 0
    || deferredCount > 0
    || restrictedCount > 0
    || awaitingManualCount > 0
    || (!skipRemoveExtra && preservedExtraCount > 0)
  ) {
    sourceStatus = 'partial'
  }

  let finalPlexUpdatedAt = plexUpdatedAt
  if (plexPlaylist?.ratingKey) {
    finalPlexUpdatedAt = await getPlaylistUpdatedAt(plexPlaylist.ratingKey)
  }

  if (!dryRun) {
    if (pendingPlaylistWrite(source.id) || !sourceConvergenceCheckpointIsCurrent(source, input.config, input.checkpoint)) {
      const summary = '同步期间配置或媒体关联已变化，等待下次对齐'
      updateSource(source.id, { lastSyncedAt: new Date().toISOString(), lastJobId: job.getId(),
        lastStatus: 'partial', lastError: summary, requiresMatchReconcile: true })
      return { kind: 'deferred', reason: 'superseded', status: 'partial', failedSongs: failCount, summary }
    }
    recordSourceSongResults(source.id, job, input.checkpoint.bindings)
    if (input.verifiedPlaylistItems) recordPlaylistAlignmentValidation({ sourceId: source.id, playlistItems: input.verifiedPlaylistItems })
    if (input.neteaseCursor) recordSourceComparison(source.id, { neteaseCursor: input.neteaseCursor })
    // Source rate limits remain unresolved until this pass completes every upstream stage.
    confirmSourceConvergenceCompleted(source.id)
    const sourceUpdate: Parameters<typeof updateSource>[1] = {
      lastSyncedAt: new Date().toISOString(),
      lastStatus: sourceStatus,
      lastError: sourceStatus === 'success'
        ? null
        : [
            failCount > 0 ? `${failCount} 首失败` : '',
            restrictedCount > 0 ? `${restrictedCount} 首版权受限` : '',
            ignoredCount > 0 ? `${ignoredCount} 首已忽略` : '',
            deferredCount > 0 ? `${deferredCount} 首等待恢复` : '',
            awaitingManualCount > 0 ? `${awaitingManualCount} 首暂未加入同步` : '',
            !skipRemoveExtra && preservedExtraCount > 0 ? `${preservedExtraCount} 首保留待确认` : '',
          ].filter(Boolean).join('，'),
      lastJobId: job.getId(),
      trackCount: authoritativeTrackCount,
      plexPlaylistRatingKey: plexPlaylist?.ratingKey || '',
      plexUpdatedAt: finalPlexUpdatedAt,
      consecutiveSkips: 0,
    }
    if (fullVerification) sourceUpdate.lastFullCompareAt = new Date().toISOString()
    if (sourceStatus === 'success') {
      sourceUpdate.lastTrackUpdateTime = trackUpdateTime
      sourceUpdate.trackIdSnapshot = JSON.stringify(currentIdOrder)
    }
    // A completed pass resolves the pending match work even when known
    // download failures keep the source partial. Active corrections still
    // need another pass, so their flag remains until they are applied.
    if (!hasActiveMediaCorrectionsForSource(source.id)) {
      sourceUpdate.requiresMatchReconcile = false
    }
    updateSource(source.id, sourceUpdate)
  }

  const parts = [`${succCount} 新增成功`, `${existingCount} 已存在`]
  if (failCount > 0) parts.push(`${failCount} 失败`)
  if (restrictedCount > 0) parts.push(`${restrictedCount} 版权受限`)
  if (ignoredCount > 0) parts.push(`${ignoredCount} 已忽略`)
  if (deferredCount > 0) parts.push(`${deferredCount} 等待恢复`)
  if (awaitingManualCount > 0) parts.push(`${awaitingManualCount} 等待手动选择`)
  if (!skipRemoveExtra && preservedExtraCount > 0) parts.push(`${preservedExtraCount} 保留待确认`)

  const summary = parts.join('，')
  return { kind: 'completed', status: sourceStatus, failedSongs: failCount, summary }
}

function recordSourceSongResults(sourceId: string, job: RunBuilder, bindingVersions?: BindingVersionSnapshot): void {
  const songs = job.getRun().songs.filter(song => song.sourceId === sourceId)
  for (const song of songs) {
    if (typeof song.neteaseIndex !== 'number') continue
    const matchTrace = song.metadata?.matchTrace as MatchTrace | undefined
    if (bindingVersions && typeof song.neteaseSongId === 'number' && matchTrace?.ratingKey
      && matchTrace.identity?.bindingStatus === 'active'
      && song.status !== 'ignored_failure' && song.status !== 'awaiting_retry') {
      confirmSongIdentity(sourceId, { songId: song.neteaseSongId, songName: song.songName,
        ratingKey: matchTrace.ratingKey, plexFilePath: matchTrace.identity.plexFilePath })
    }
    recordPlaylistOccurrenceSyncResult({
      sourceId,
      position: song.neteaseIndex,
      runId: job.getId(),
      status: song.status,
      matchTrace: song.metadata?.matchTrace,
      error: song.error as Record<string, unknown> | undefined,
      expectedBindingUpdatedAt: typeof song.neteaseSongId === 'number' ? bindingVersions?.get(song.neteaseSongId) : undefined,
    })
  }
}
