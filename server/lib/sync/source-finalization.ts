import type { RunBuilder } from '../run/builder'
import type { JobStepContext } from '../job/types'
import { describeDomainError } from '../domain-error'
import { getPlaylistUpdatedAt } from '../plex-client'
import { updateSource } from '../playlist/store'
import type { PlaylistSource } from '../playlist/types'
import { recordPlaylistOccurrenceSyncResult } from './match-management-store'
import { isAwaitingManualSongStatus } from '../../../lib/media-status-projection'
import { hasActiveMediaCorrectionsForSource } from './media-corrections'
import { recordFailure, resolveFailures } from '../tasks/failure-records'

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
}): string {
  const { source, job, context, error, stage, dryRun } = input
  const sourceSteps = job.getRun().steps.filter(step => step.context?.sourceId === source.id)
  const stepCode = sourceSteps.filter(step => step.status === 'failed').at(-1)?.error?.code
  const cause = describeDomainError(error, stepCode)
  const message = cause.diagnostic ?? '未知错误'
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
    recordFailure({ sourceId: source.id, sourceName: source.name, songName: '来源同步',
      runId: job.getId(), runType: 'sync', failureKind: cause.code, failureReason: message })
    updateSource(source.id, {
      lastSyncedAt: new Date().toISOString(),
      lastStatus: 'failed',
      lastError: message,
      lastJobId: job.getId(),
    })
  }
  return message
}

export interface SourceConvergenceResult {
  status: PlaylistSource['lastStatus']
  failedSongs: number
  summary: string
}

interface FinalizeSourceConvergenceInput {
  source: PlaylistSource
  job: RunBuilder
  dryRun: boolean
  fullVerification: boolean
  skipRemoveExtra: boolean
  authoritativeTrackCount: number
  currentIdOrder: number[]
  trackUpdateTime: number | null
  plexUpdatedAt: number | null
  plexPlaylist: PlexPlaylistIdentity | null | undefined
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
  const preservedExtraCount = sourceSongs.filter(song => song.status === 'extra_skipped').length
  const awaitingManualCount = sourceSongs.filter(song => isAwaitingManualSongStatus(song.status)).length

  let sourceStatus: PlaylistSource['lastStatus'] = 'success'
  if (failCount > 0 && resolvedTargetCount === 0) {
    sourceStatus = 'failed'
  } else if (
    failCount > 0
    || ignoredCount > 0
    || restrictedCount > 0
    || awaitingManualCount > 0
    || (!skipRemoveExtra && preservedExtraCount > 0)
  ) {
    sourceStatus = 'partial'
  }

  if (!dryRun) {
    for (const song of sourceSongs) {
      if (typeof song.neteaseIndex !== 'number') continue
      recordPlaylistOccurrenceSyncResult({
        sourceId: source.id,
        position: song.neteaseIndex,
        runId: job.getId(),
        status: song.status,
        matchTrace: song.metadata?.matchTrace as Record<string, unknown> | undefined,
        error: song.error as Record<string, unknown> | undefined,
      })
    }
  }

  let finalPlexUpdatedAt = plexUpdatedAt
  if (plexPlaylist?.ratingKey) {
    finalPlexUpdatedAt = await getPlaylistUpdatedAt(plexPlaylist.ratingKey)
  }

  if (!dryRun) {
    resolveFailures({ sourceId: source.id, songName: '来源同步' })
    const sourceUpdate: Parameters<typeof updateSource>[1] = {
      lastSyncedAt: new Date().toISOString(),
      lastStatus: sourceStatus,
      lastError: sourceStatus === 'success'
        ? null
        : [
            failCount > 0 ? `${failCount} 首失败` : '',
            restrictedCount > 0 ? `${restrictedCount} 首版权受限` : '',
            ignoredCount > 0 ? `${ignoredCount} 首已忽略` : '',
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
  if (awaitingManualCount > 0) parts.push(`${awaitingManualCount} 等待手动选择`)
  if (!skipRemoveExtra && preservedExtraCount > 0) parts.push(`${preservedExtraCount} 保留待确认`)

  const summary = parts.join('，')
  return { status: sourceStatus, failedSongs: failCount, summary }
}
