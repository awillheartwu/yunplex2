import { getDb } from '../db'
import type { SongStatus, TaskRun } from '../job/types'
import { recordFailure, observeFailureSubject } from '../tasks/failure-records'
import type { FailureSubject } from '../tasks/failure-identity'

const FAILURE_STATUSES = new Set<SongStatus>([
  'failed_download',
  'failed_tags',
  'failed_plex_match',
  'failed_plex_insert',
  'copyright_restricted',
])

export function reconcileRunFailures(run: TaskRun): void {
  for (const song of run.songs || []) {
    const sourceName = song.sourceId || run.source
    const subject: FailureSubject = {
      songId: song.neteaseSongId, songName: song.songName, artist: song.artist, sourceId: song.sourceId,
      plexPlaylistRatingKey: song.metadata?.plexPlaylistRatingKey,
      plexPlaylistItemId: song.metadata?.plexPlaylistItemId,
    }
    if (FAILURE_STATUSES.has(song.status)) {
      const fileFailure = ['failed_download', 'failed_tags', 'copyright_restricted'].includes(song.status)
        ? getDb().prepare(`SELECT task.id FROM download_tasks task
            LEFT JOIN run_file_tasks caller ON caller.task_id = task.id AND caller.run_id = ?
            WHERE task.song_id = ? AND task.status = 'failed'
              AND (caller.run_id IS NOT NULL OR COALESCE(task.run_id, task.job_id) = ?)
              AND COALESCE(caller.source_id, task.source_id, '') = ?
            ORDER BY task.updated_at DESC LIMIT 1`)
          .get(run.id, song.neteaseSongId ?? null, run.id, song.sourceId ?? '') as { id: string } | undefined
        : undefined
      recordFailure({
        ...subject,
        sourceName,
        runId: run.id,
        runType: run.type,
        failureKind: song.error?.code ?? song.status,
        failureReason: song.error?.message || song.error?.title || song.status,
        occurredAt: run.finishedAt || new Date().toISOString(),
        downloadTaskId: fileFailure?.id,
      })
    } else if (song.status === 'ignored_failure' || song.status === 'awaiting_retry') {
      // Observing an ignored problem links this run without recording another failure.
      observeFailureSubject(subject, run.id, run.finishedAt || undefined)

    }
  }
}
