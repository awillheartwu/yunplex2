import type { StepError, SongTask } from '../job/types'
import type { PlexReorderError, ReorderFailure } from './reorder'

interface ReorderFailureRunUpdater {
  updateSong(songId: string, update: Partial<Pick<SongTask, 'status' | 'phase' | 'error'>>): void
}

export interface ReorderFailureTargets {
  ratingKeyToSongIds?: Map<string, string[]>
  playlistItemIdToRatingKey?: Map<number, string>
  playlistItemIdToRemovedSongId?: Map<number, string>
}

export function buildPlexReorderStepError(error: PlexReorderError): StepError {
  return {
    title: 'Plex 歌单重排失败',
    message: error.message,
    stage: 'plex_insert',
    context: {
      failures: error.result.failures,
      inserted: error.result.inserted,
      removed: error.result.removed,
      moved: error.result.moved,
    },
  }
}

export function markPlexReorderFailures(
  job: ReorderFailureRunUpdater,
  failures: ReorderFailure[],
  targets: ReorderFailureTargets,
): number {
  const markedSongIds = new Set<string>()

  for (const failure of failures) {
    for (const songId of resolveFailureSongIds(failure, targets)) {
      if (markedSongIds.has(songId)) continue
      job.updateSong(songId, {
        status: 'failed_plex_insert',
        phase: 'plex_insert',
        error: {
          title: describeFailureTitle(failure),
          message: failure.message,
          stage: 'plex_insert',
          context: {
            action: failure.action,
            ratingKey: failure.ratingKey,
            playlistItemId: failure.playlistItemId,
          },
        },
      })
      markedSongIds.add(songId)
    }
  }

  return markedSongIds.size
}

function resolveFailureSongIds(failure: ReorderFailure, targets: ReorderFailureTargets): string[] {
  if (failure.action === 'remove' && failure.playlistItemId) {
    const removedSongId = targets.playlistItemIdToRemovedSongId?.get(failure.playlistItemId)
    if (removedSongId) return [removedSongId]
  }

  if (failure.ratingKey) {
    const songIds = targets.ratingKeyToSongIds?.get(failure.ratingKey)
    if (songIds?.length) return songIds
  }

  if (failure.playlistItemId) {
    const removedSongId = targets.playlistItemIdToRemovedSongId?.get(failure.playlistItemId)
    if (removedSongId) return [removedSongId]

    const ratingKey = targets.playlistItemIdToRatingKey?.get(failure.playlistItemId)
    if (ratingKey) return targets.ratingKeyToSongIds?.get(ratingKey) ?? []
  }

  return []
}

function describeFailureTitle(failure: ReorderFailure): string {
  if (failure.action === 'remove') return 'Plex 歌单移除失败'
  if (failure.action === 'move') return 'Plex 歌单排序失败'
  return 'Plex 歌单插入失败'
}
