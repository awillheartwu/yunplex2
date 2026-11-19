import type Database from 'better-sqlite3'
import { failureFingerprint } from '../tasks/failure-identity'

interface FailureRow {
  id: string
  fingerprint: string
  song_id: number | null
  song_name: string
  artist: string
  source_id: string | null
  failure_kind: string
  failure_reason: string
  status: string
  first_seen_at: string
  last_seen_at: string
  occurrence_count: number
  attempt_count: number
  ignore_reason: string | null
  ignored_at: string | null
  retry_count: number
  download_task_ids: string | null
}

function legacyKind(row: FailureRow): string | null {
  if (row.failure_kind === 'filesystem_failed' && row.failure_reason.includes('未提供可用音源')) return 'source_unavailable'
  if (row.failure_kind === 'validation_failed' && row.failure_reason.includes('文件头无效')) return 'invalid_audio'
  if (row.failure_kind === 'failed_download' && row.failure_reason.includes('尚不支持')) return 'unsupported_format'
  if (row.failure_kind === 'failed_download' && row.failure_reason.includes('无法获取目标歌曲信息')) return 'source_missing'
  return null
}

const STATUS_PRIORITY: Record<string, number> = { ignored: 3, open: 2, resolved: 1 }

/** One-time, idempotent reclassification of records written before typed errors. */
export function migrateLegacyFailureKinds(db: Database.Database): number {
  const rows = db.prepare(`
    SELECT id, fingerprint, song_id, song_name, artist, source_id, failure_kind, failure_reason,
      status, first_seen_at, last_seen_at, occurrence_count, attempt_count, ignore_reason, ignored_at, retry_count, download_task_ids
    FROM failure_records
    WHERE (failure_kind = 'filesystem_failed' AND failure_reason LIKE '%未提供可用音源%')
       OR (failure_kind = 'validation_failed' AND failure_reason LIKE '%文件头无效%')
       OR (failure_kind = 'failed_download' AND failure_reason LIKE '%尚不支持%')
       OR (failure_kind = 'failed_download' AND failure_reason LIKE '%无法获取目标歌曲信息%')
  `).all() as FailureRow[]
  if (rows.length === 0) return 0

  return db.transaction(() => {
    let migrated = 0
    for (const row of rows) {
      const kind = legacyKind(row)
      if (!kind) continue
      const fingerprint = failureFingerprint({
        songId: row.song_id,
        songName: row.song_name,
        artist: row.artist,
        sourceId: row.source_id,
        failureKind: kind,
      })
      const existing = db.prepare('SELECT * FROM failure_records WHERE fingerprint = ? AND id != ?')
        .get(fingerprint, row.id) as FailureRow | undefined
      if (existing) {
        const retained = (STATUS_PRIORITY[row.status] ?? 0) >= (STATUS_PRIORITY[existing.status] ?? 0) ? row : existing
        const status = retained.status
        const taskIds = new Set([...(existing.download_task_ids ?? '').split(','), ...(row.download_task_ids ?? '').split(',')].filter(Boolean))
        db.prepare(`
          UPDATE failure_records SET status = ?, first_seen_at = ?, last_seen_at = ?,
            occurrence_count = ?, retry_count = ?, download_task_ids = ?,
            attempt_count = ?, ignore_reason = ?, ignored_at = ?
          WHERE fingerprint = ?
        `).run(status, row.first_seen_at < existing.first_seen_at ? row.first_seen_at : existing.first_seen_at,
          row.last_seen_at > existing.last_seen_at ? row.last_seen_at : existing.last_seen_at,
          existing.occurrence_count + row.occurrence_count, existing.retry_count + row.retry_count,
          [...taskIds].join(','), status === 'resolved' ? 0 : existing.attempt_count + row.attempt_count,
          status === 'ignored' ? retained.ignore_reason : null, status === 'ignored' ? retained.ignored_at : null, fingerprint)
        db.prepare('INSERT OR IGNORE INTO failure_occurrences (fingerprint, occurrence_key, occurred_at) SELECT ?, occurrence_key, occurred_at FROM failure_occurrences WHERE fingerprint = ?')
          .run(fingerprint, row.fingerprint)
        db.prepare('DELETE FROM failure_occurrences WHERE fingerprint = ?').run(row.fingerprint)
        db.prepare('DELETE FROM failure_records WHERE id = ?').run(row.id)
      } else {
        db.prepare('INSERT OR IGNORE INTO failure_occurrences (fingerprint, occurrence_key, occurred_at) SELECT ?, occurrence_key, occurred_at FROM failure_occurrences WHERE fingerprint = ?')
          .run(fingerprint, row.fingerprint)
        db.prepare('UPDATE failure_records SET failure_kind = ?, fingerprint = ? WHERE id = ?').run(kind, fingerprint, row.id)
        db.prepare('DELETE FROM failure_occurrences WHERE fingerprint = ?').run(row.fingerprint)
      }
      migrated++
    }
    return migrated
  })()
}
