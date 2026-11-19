import { getDb } from '../db'
import { resolveRecordedFailures } from './failure-records'
import { getSongIdentityBinding } from '../sync/identity-store'
import { plexPathsExactlyEqual } from '../sync/identity-normalization'
import { failureSubjectKey } from './failure-identity'
import type { EnvironmentProblem } from './recovery-targets'

/** Only a completed equivalent file operation can discharge a saved file intent. */
export function completeFileTask(taskId: string): void {
  const task = getDb().prepare("SELECT song_id,updated_at FROM download_tasks WHERE id=? AND status='done'")
    .get(taskId) as { song_id: number; updated_at: string } | undefined
  if (!task) return
  const subjects = getDb().prepare(`SELECT DISTINCT source_id,song_id,song_name,artist FROM failure_records
    WHERE status IN ('open','ignored') AND song_id=? AND TRIM(COALESCE(download_task_ids,''))<>''`)
    .all(task.song_id) as { source_id: string | null; song_id: number; song_name: string; artist: string }[]
  for (const subject of subjects) resolveRecordedFailures({ sourceId: subject.source_id, songId: subject.song_id,
    songName: subject.song_name, artist: subject.artist, evidence: 'file', includeIgnored: true,
    downloadTaskId: taskId, resolvedAt: task.updated_at })
}

export function confirmSongDetailsAvailable(sourceId: string, songs: ReadonlyMap<number, { name: string }>): void {
  for (const [songId, song] of songs) resolveRecordedFailures({ sourceId, songId, songName: song.name,
    failureKinds: ['source_missing'], evidence: 'details' })
}

export function confirmSourceRead(sourceId: string): void {
  resolveRecordedFailures({ sourceId, songName: '来源同步', evidence: 'source',
    failureKinds: ['authentication_failed', 'netease_unavailable', 'source_missing'] })
}

export function confirmSourceConvergenceCompleted(sourceId: string): void {
  // In particular, upstream read success cannot discharge later Plex throttling.
  resolveRecordedFailures({ sourceId, songName: '来源同步', evidence: 'source' })
}

export function confirmSongIdentity(sourceId: string, identity: {
  songId: number; songName: string; ratingKey: string; plexFilePath: string
}): void {
  const binding = getSongIdentityBinding(identity.songId)
  if (binding?.status !== 'active' || !['path', 'manual'].includes(binding.bindingMethod) || binding.plexRatingKey !== identity.ratingKey
    || !plexPathsExactlyEqual(binding.plexFilePath, identity.plexFilePath)) return
  // Historical unlinked download errors describe the same identity failure.
  // Associated file tasks still require completeFileTask's completion evidence.
  resolveRecordedFailures({ sourceId, songId: identity.songId, songName: identity.songName,
    evidence: 'identity', includeIgnored: true,
    failureKinds: ['failed_plex_match', 'media_identity_conflict', 'failed_download'] })
  if (binding.bindingMethod === 'manual') confirmManualBindingSupersedesFileIntents(identity.songId)
}

/** An explicit newer choice ends previous writes without claiming that they ran. */
export function confirmManualBindingSupersedesFileIntents(songId: number): void {
  const binding = getSongIdentityBinding(songId)
  if (binding?.status !== 'active' || binding.bindingMethod !== 'manual') return
  const files = getDb().prepare(`SELECT id,source_id,song_name,artist FROM failure_records WHERE song_id=?
    AND status IN ('open','ignored') AND TRIM(COALESCE(download_task_ids,''))<>''`)
    .all(songId) as { id: string; source_id: string | null; song_name: string; artist: string }[]
  for (const file of files) resolveRecordedFailures({ sourceId: file.source_id, songId,
    songName: file.song_name, artist: file.artist, evidence: 'superseded', includeIgnored: true, failureIds: [file.id] })
}

export function confirmPlaylistReconciled(sourceId: string, result: {
  targets: readonly { songId: number; songName: string; ratingKey: string }[]
  items: readonly { ratingKey: string; playlistItemId: number }[]
}): void {
  const present = new Set(result.items.map(item => item.ratingKey))
  for (const target of result.targets) {
    if (!present.has(target.ratingKey)) continue
    resolveRecordedFailures({ sourceId, songId: target.songId, songName: target.songName,
      evidence: 'playlist', includeIgnored: true,
      failureKinds: ['failed_plex_insert', 'plex_authentication_failed', 'plex_unavailable', 'rate_limited'] })
  }
}

interface PlaylistItem { plexPlaylistRatingKey: string; plexPlaylistItemId: number }

export function confirmPlaylistItemAbsent(sourceId: string, item: PlaylistItem): void {
  resolveRecordedFailures({ sourceId, songName: '', ...item, evidence: 'playlist', includeIgnored: true })
}

/** A changed target ends the old removal request without claiming a deletion. */
export function supersedePlaylistItemRemoval(sourceId: string, item: PlaylistItem): void {
  resolveRecordedFailures({ sourceId, songName: '', ...item, evidence: 'superseded' })
}

/** Login validates NetEase credentials; a Plex library probe cannot prove the original operation. */
export function confirmNeteaseAuthentication(problems: readonly EnvironmentProblem[]): void {
  for (const problem of problems) {
    if (!problem.sourceId || problem.subjectKey !== failureSubjectKey({ sourceId: problem.sourceId, songName: '来源同步' })) continue
    resolveRecordedFailures({ sourceId: problem.sourceId, songName: '来源同步', evidence: 'source',
      failureKinds: ['authentication_failed'], failureIds: [problem.id] })
  }
}
