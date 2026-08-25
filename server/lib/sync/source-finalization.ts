import type { RunBuilder } from '../run/builder'
import { getPlaylistUpdatedAt } from '../plex-client'
import { updateSource } from '../playlist/store'
import type { PlaylistSource } from '../playlist/types'
import { recordPlaylistOccurrenceSyncResult } from './match-management-store'

interface PlexPlaylistIdentity {
  ratingKey: string
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

  let sourceStatus: PlaylistSource['lastStatus'] = 'success'
  if (failCount > 0 && resolvedTargetCount === 0) {
    sourceStatus = 'failed'
  } else if (
    failCount > 0
    || restrictedCount > 0
    || ignoredCount > 0
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
    const sourceUpdate: Parameters<typeof updateSource>[1] = {
      lastSyncedAt: new Date().toISOString(),
      lastStatus: sourceStatus,
      lastError: sourceStatus === 'success'
        ? null
        : [
            failCount > 0 ? `${failCount} 首失败` : '',
            restrictedCount > 0 ? `${restrictedCount} 首版权受限` : '',
            ignoredCount > 0 ? `${ignoredCount} 首已暂停重试` : '',
            !skipRemoveExtra && preservedExtraCount > 0 ? `${preservedExtraCount} 首保留待确认` : '',
          ].filter(Boolean).join('，'),
      lastJobId: job.getId(),
      trackCount: authoritativeTrackCount,
      plexPlaylistRatingKey: plexPlaylist?.ratingKey || '',
      plexUpdatedAt: finalPlexUpdatedAt,
      consecutiveSkips: 0,
      lastFullCompareAt: new Date().toISOString(),
    }
    if (sourceStatus === 'success') {
      sourceUpdate.lastTrackUpdateTime = trackUpdateTime
      sourceUpdate.trackIdSnapshot = JSON.stringify(currentIdOrder)
      sourceUpdate.requiresMatchReconcile = false
    }
    updateSource(source.id, sourceUpdate)
  }

  const parts = [`${succCount} 新增成功`, `${existingCount} 已存在`]
  if (failCount > 0) parts.push(`${failCount} 失败`)
  if (restrictedCount > 0) parts.push(`${restrictedCount} 版权受限`)
  if (ignoredCount > 0) parts.push(`${ignoredCount} 已暂停重试`)
  if (!skipRemoveExtra && preservedExtraCount > 0) parts.push(`${preservedExtraCount} 保留待确认`)

  const summary = parts.join('，')
  return { status: sourceStatus, failedSongs: failCount, summary }
}
