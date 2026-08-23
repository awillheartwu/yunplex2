import { randomUUID } from 'node:crypto'
import type { SongStatus, TaskRun, TaskRunType } from '../job/types'
import { getDb } from '../db'
import { dateEndBoundary, dateStartBoundary } from '../date-range'
import {
  failureFingerprint,
  failureSubjectKey,
  normalizeFailureIdentityPart,
} from './failure-identity'

export { failureFingerprint, failureSubjectKey } from './failure-identity'

export type FailureRecordStatus = 'open' | 'ignored' | 'resolved'

export interface FailureRecord {
  id: string
  fingerprint: string
  subjectKey: string
  songId: number | null
  songName: string
  artist: string
  sourceId: string | null
  sourceName: string
  runId: string | null
  runType: TaskRunType
  failureKind: string
  failureReason: string
  status: FailureRecordStatus
  firstSeenAt: string
  lastSeenAt: string
  ignoredAt: string | null
  resolvedAt: string | null
  occurrenceCount: number
  retryCount: number
  downloadTaskIds: string[]
}

export interface FailureRecordFilter {
  status?: FailureRecordStatus
  type?: TaskRunType
  failureKind?: string
  excludeFailureKinds?: string[]
  sourceId?: string
  search?: string
  from?: string
  to?: string
  timeZone?: string
  limit?: number
  offset?: number
}

export interface SourceFailurePolicyEntry {
  failureKind: string
  occurrenceCount: number
  phase: 'download' | 'tags' | 'plex_match' | 'plex_insert'
}

export interface SourceFailurePolicy {
  copyrightSongIds: number[]
  failuresBySongId: Record<number, SourceFailurePolicyEntry>
}

export interface SourceFailureCounts {
  actionable: number
  copyrightRestricted: number
}

const FAILURE_STATUSES = new Set<SongStatus>([
  'failed_download',
  'failed_tags',
  'failed_plex_match',
  'failed_plex_insert',
  'copyright_restricted',
])

function rowToRecord(row: Record<string, unknown>): FailureRecord {
  const rawFirstSeenAt = String(row.first_seen_at)
  const rawLastSeenAt = String(row.last_seen_at)
  const firstSeenAt = rawFirstSeenAt <= rawLastSeenAt ? rawFirstSeenAt : rawLastSeenAt
  const lastSeenAt = rawFirstSeenAt <= rawLastSeenAt ? rawLastSeenAt : rawFirstSeenAt

  return {
    id: String(row.id),
    fingerprint: String(row.fingerprint),
    subjectKey: String(row.subject_key),
    songId: row.song_id === null ? null : Number(row.song_id),
    songName: String(row.song_name),
    artist: String(row.artist || ''),
    sourceId: row.source_id === null ? null : String(row.source_id),
    sourceName: String(row.source_name || ''),
    runId: row.run_id === null ? null : String(row.run_id),
    runType: String(row.run_type) as TaskRunType,
    failureKind: String(row.failure_kind),
    failureReason: String(row.failure_reason || ''),
    status: String(row.status) as FailureRecordStatus,
    firstSeenAt,
    lastSeenAt,
    ignoredAt: row.ignored_at === null ? null : String(row.ignored_at),
    resolvedAt: row.resolved_at === null ? null : String(row.resolved_at),
    occurrenceCount: Number(row.occurrence_count),
    retryCount: Number(row.retry_count),
    downloadTaskIds: String(row.download_task_ids || '').split(',').filter(Boolean),
  }
}

export function recordFailure(input: {
  songId?: number | null
  songName: string
  artist?: string
  sourceId?: string | null
  sourceName?: string
  runId?: string | null
  runType: TaskRunType
  failureKind: string
  failureReason?: string
  occurredAt?: string
  downloadTaskId?: string
}): FailureRecord {
  const db = getDb()
  const source = input.sourceId
    ? db.prepare(`
        SELECT COALESCE(NULLIF(name, ''), NULLIF(netease_playlist_name, '')) AS name
        FROM playlist_sources
        WHERE id = ?
      `).get(input.sourceId) as { name: string | null } | undefined
    : undefined
  const run = input.runId
    ? db.prepare('SELECT type FROM task_runs WHERE id = ?').get(input.runId) as { type: TaskRunType } | undefined
    : undefined
  const sourceName = source?.name || input.sourceName || input.sourceId || (input.runType === 'manual_download' ? '手动下载' : '')
  const runType = run?.type || input.runType
  const occurredAt = input.occurredAt || new Date().toISOString()
  const fingerprint = failureFingerprint(input)
  const occurrenceKey = input.runId
    ? `run:${input.runId}`
    : input.downloadTaskId
      ? `download:${input.downloadTaskId}`
      : `event:${occurredAt}:${normalizeFailureIdentityPart(input.failureReason)}`
  const occurrenceResult = db.prepare(`
    INSERT OR IGNORE INTO failure_occurrences (fingerprint, occurrence_key, occurred_at)
    VALUES (?, ?, ?)
  `).run(fingerprint, occurrenceKey, occurredAt)
  const isNewOccurrence = occurrenceResult.changes > 0
  const existing = db.prepare('SELECT * FROM failure_records WHERE fingerprint = ?').get(fingerprint) as Record<string, unknown> | undefined
  if (existing) {
    const current = rowToRecord(existing)
    const firstSeenAt = occurredAt < current.firstSeenAt ? occurredAt : current.firstSeenAt
    const lastSeenAt = occurredAt > current.lastSeenAt ? occurredAt : current.lastSeenAt
    const taskIds = new Set(current.downloadTaskIds)
    if (input.downloadTaskId) taskIds.add(input.downloadTaskId)
    const status = current.status === 'ignored'
      ? 'ignored'
      : current.status === 'resolved' && !isNewOccurrence
        ? 'resolved'
        : 'open'
    const reason = input.failureReason || ''
    db.prepare(`
      UPDATE failure_records
      SET song_id = ?, song_name = ?, artist = ?, source_id = ?, source_name = ?,
        run_id = ?, run_type = ?, failure_reason = ?, status = ?,
        first_seen_at = ?, last_seen_at = ?,
        resolved_at = CASE WHEN ? THEN NULL ELSE resolved_at END,
        occurrence_count = ?, download_task_ids = ?
      WHERE fingerprint = ?
    `).run(
      input.songId ?? null,
      input.songName,
      input.artist || '',
      input.sourceId ?? null,
      sourceName,
      input.runId ?? null,
      runType,
      reason,
      status,
      firstSeenAt,
      lastSeenAt,
      isNewOccurrence ? 1 : 0,
      current.occurrenceCount + (isNewOccurrence ? 1 : 0),
      [...taskIds].join(','),
      fingerprint,
    )
  } else {
    db.prepare(`
      INSERT INTO failure_records (
        id, fingerprint, subject_key, song_id, song_name, artist, source_id,
        source_name, run_id, run_type, failure_kind, failure_reason, status,
        first_seen_at, last_seen_at, ignored_at, resolved_at,
        occurrence_count, retry_count, download_task_ids
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, NULL, NULL, ?, 0, ?)
    `).run(
      randomUUID(),
      fingerprint,
      failureSubjectKey(input),
      input.songId ?? null,
      input.songName,
      input.artist || '',
      input.sourceId ?? null,
      sourceName,
      input.runId ?? null,
      runType,
      input.failureKind,
      input.failureReason || '',
      occurredAt,
      occurredAt,
      1,
      input.downloadTaskId || null,
    )
  }
  return rowToRecord(db.prepare('SELECT * FROM failure_records WHERE fingerprint = ?').get(fingerprint) as Record<string, unknown>)
}

export function resolveFailures(input: {
  songId?: number | null
  songName: string
  artist?: string
  sourceId?: string | null
  failureKinds?: string[]
  resolvedAt?: string
}): number {
  const subject = failureSubjectKey(input)
  const resolvedAt = input.resolvedAt || new Date().toISOString()
  const params: unknown[] = [resolvedAt, subject, resolvedAt]
  let kindClause = ''
  if (input.failureKinds?.length) {
    kindClause = ` AND failure_kind IN (${input.failureKinds.map(() => '?').join(',')})`
    params.push(...input.failureKinds)
  }
  const result = getDb().prepare(`
    UPDATE failure_records
    SET status = 'resolved', resolved_at = ?, ignored_at = NULL
    WHERE subject_key = ? AND status = 'open' AND last_seen_at <= ?${kindClause}
  `).run(...params)
  return result.changes
}

export function reconcileRunFailures(run: TaskRun): void {
  for (const song of run.songs || []) {
    const sourceName = song.sourceId || run.source
    if (FAILURE_STATUSES.has(song.status)) {
      recordFailure({
        songId: song.neteaseSongId,
        songName: song.songName,
        artist: song.artist,
        sourceId: song.sourceId,
        sourceName,
        runId: run.id,
        runType: run.type,
        failureKind: song.status,
        failureReason: song.error?.message || song.error?.title || song.status,
        occurredAt: run.finishedAt || new Date().toISOString(),
      })
    } else if (song.status === 'success' || song.status === 'skipped_existing') {
      resolveFailures({
        songId: song.neteaseSongId,
        songName: song.songName,
        artist: song.artist,
        sourceId: song.sourceId,
        resolvedAt: run.finishedAt || new Date().toISOString(),
      })
    }
  }
}

function phaseForFailureKind(failureKind: string): SourceFailurePolicyEntry['phase'] {
  if (failureKind === 'failed_tags') return 'tags'
  if (failureKind === 'failed_plex_match') return 'plex_match'
  if (failureKind === 'failed_plex_insert') return 'plex_insert'
  return 'download'
}

export function getSourceFailurePolicy(sourceId: string): SourceFailurePolicy {
  const rows = getDb().prepare(`
    SELECT song_id, failure_kind, occurrence_count, last_seen_at
    FROM failure_records
    WHERE source_id = ?
      AND status IN ('open', 'ignored')
      AND song_id IS NOT NULL
      AND failure_kind != 'ignored_failure'
    ORDER BY last_seen_at DESC
  `).all(sourceId) as Array<{
    song_id: number
    failure_kind: string
    occurrence_count: number
    last_seen_at: string
  }>
  const copyrightSongIds = new Set<number>()
  const failuresBySongId: Record<number, SourceFailurePolicyEntry> = {}

  for (const row of rows) {
    if (row.failure_kind === 'copyright_restricted') {
      copyrightSongIds.add(row.song_id)
      continue
    }
    if (failuresBySongId[row.song_id]) continue
    failuresBySongId[row.song_id] = {
      failureKind: row.failure_kind,
      occurrenceCount: row.occurrence_count,
      phase: phaseForFailureKind(row.failure_kind),
    }
  }

  return { copyrightSongIds: [...copyrightSongIds], failuresBySongId }
}

export function shouldPauseSourceFailure(
  entry: SourceFailurePolicyEntry | undefined,
  maxFailures: number,
): boolean {
  if (!entry || !maxFailures || maxFailures <= 0 || entry.occurrenceCount < maxFailures) return false
  return entry.phase === 'download' || entry.phase === 'tags'
}

export function getSourceFailureCounts(sourceId: string): SourceFailureCounts {
  const row = getDb().prepare(`
    SELECT
      SUM(CASE WHEN failure_kind = 'copyright_restricted' THEN 1 ELSE 0 END) AS copyright_restricted,
      SUM(CASE
        WHEN failure_kind NOT IN ('copyright_restricted', 'ignored_failure') THEN 1
        ELSE 0
      END) AS actionable
    FROM failure_records
    WHERE source_id = ? AND status = 'open'
  `).get(sourceId) as { actionable: number | null; copyright_restricted: number | null }
  return {
    actionable: Number(row.actionable || 0),
    copyrightRestricted: Number(row.copyright_restricted || 0),
  }
}

export function queryFailureRecords(filter: FailureRecordFilter = {}): {
  items: FailureRecord[]
  total: number
} {
  const conditions: string[] = []
  const params: unknown[] = []
  conditions.push('status = ?')
  params.push(filter.status || 'open')
  if (filter.type) {
    conditions.push('run_type = ?')
    params.push(filter.type)
  }
  if (filter.failureKind) {
    conditions.push('failure_kind = ?')
    params.push(filter.failureKind)
  }
  if (filter.excludeFailureKinds?.length) {
    conditions.push(`failure_kind NOT IN (${filter.excludeFailureKinds.map(() => '?').join(',')})`)
    params.push(...filter.excludeFailureKinds)
  }
  if (filter.sourceId) {
    conditions.push('source_id = ?')
    params.push(filter.sourceId)
  }
  if (filter.from) {
    const boundary = dateStartBoundary(filter.from, filter.timeZone)
    conditions.push('fr.last_seen_at >= ?')
    params.push(boundary.value)
  }
  if (filter.to) {
    const boundary = dateEndBoundary(filter.to, filter.timeZone)
    conditions.push(`fr.last_seen_at ${boundary.exclusive ? '<' : '<='} ?`)
    params.push(boundary.value)
  }
  if (filter.search) {
    conditions.push(`(
      LOWER(fr.song_name) LIKE ? OR LOWER(fr.artist) LIKE ? OR
      LOWER(fr.failure_reason) LIKE ? OR LOWER(fr.source_name) LIKE ? OR
      LOWER(COALESCE(ps.name, '')) LIKE ? OR
      LOWER(COALESCE(ps.netease_playlist_name, '')) LIKE ?
    )`)
    const query = `%${filter.search.trim().toLowerCase()}%`
    params.push(query, query, query, query, query, query)
  }
  const where = `WHERE ${conditions.join(' AND ')}`
  const db = getDb()
  const from = 'FROM failure_records fr LEFT JOIN playlist_sources ps ON ps.id = fr.source_id'
  const total = (db.prepare(`SELECT COUNT(*) AS count ${from} ${where}`).get(...params) as { count: number }).count
  const rows = db.prepare(`
    SELECT fr.*,
      CASE
        WHEN ps.id IS NOT NULL AND (fr.source_name = '' OR fr.source_name = fr.source_id)
          THEN COALESCE(NULLIF(ps.name, ''), NULLIF(ps.netease_playlist_name, ''), fr.source_name)
        ELSE fr.source_name
      END AS source_name
    ${from}
    ${where}
    ORDER BY fr.last_seen_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, filter.limit ?? 50, filter.offset ?? 0) as Array<Record<string, unknown>>
  return { items: rows.map(rowToRecord), total }
}

export function getFailureRecords(ids: string[]): FailureRecord[] {
  if (ids.length === 0) return []
  const rows = getDb().prepare(
    `SELECT * FROM failure_records WHERE id IN (${ids.map(() => '?').join(',')})`,
  ).all(...ids) as Array<Record<string, unknown>>
  return rows.map(rowToRecord)
}

export function setFailureRecordStatus(ids: string[], status: FailureRecordStatus): number {
  if (ids.length === 0) return 0
  const now = new Date().toISOString()
  const result = getDb().prepare(`
    UPDATE failure_records
    SET status = ?,
      ignored_at = CASE WHEN ? = 'ignored' THEN ? ELSE NULL END,
      resolved_at = CASE WHEN ? = 'resolved' THEN ? WHEN ? = 'open' THEN NULL ELSE resolved_at END
    WHERE id IN (${ids.map(() => '?').join(',')})
  `).run(status, status, now, status, now, status, ...ids)
  return result.changes
}

export function incrementFailureRetries(ids: string[]): number {
  if (ids.length === 0) return 0
  return getDb().prepare(
    `UPDATE failure_records SET retry_count = retry_count + 1 WHERE id IN (${ids.map(() => '?').join(',')})`,
  ).run(...ids).changes
}

export function backfillFailureRecords(): number {
  const db = getDb()
  const before = (db.prepare('SELECT COUNT(*) AS count FROM failure_records').get() as { count: number }).count
  const runs = db.prepare('SELECT data FROM task_runs ORDER BY started_at ASC').all() as Array<{ data: string }>
  for (const row of runs) {
    try {
      reconcileRunFailures(JSON.parse(row.data) as TaskRun)
    } catch {
      // Preserve startup even if an old run payload is malformed.
    }
  }
  const downloads = db.prepare(`
    SELECT dt.*, COALESCE(ps.name, '手动下载') AS source_name,
      COALESCE(tr.type, 'manual_download') AS run_type
    FROM download_tasks dt
    LEFT JOIN playlist_sources ps ON ps.id = dt.source_id
    LEFT JOIN task_runs tr ON tr.id = COALESCE(dt.run_id, dt.job_id)
    WHERE dt.source_id IS NULL
    ORDER BY dt.created_at ASC
  `).all() as Array<Record<string, unknown>>
  for (const task of downloads) {
    const base = {
      songId: Number(task.song_id),
      songName: String(task.song_name),
      artist: String(task.artist || ''),
      sourceId: task.source_id === null ? null : String(task.source_id),
      sourceName: String(task.source_name),
    }
    if (task.status === 'failed') {
      const reason = String(task.error || '下载失败')
      recordFailure({
        ...base,
        runId: task.run_id ? String(task.run_id) : task.job_id ? String(task.job_id) : null,
        runType: String(task.run_type) as TaskRunType,
        failureKind: /metadata|tag|标签/i.test(reason) ? 'failed_tags' : /copyright|版权/i.test(reason) ? 'copyright_restricted' : 'failed_download',
        failureReason: reason,
        occurredAt: String(task.updated_at),
        downloadTaskId: String(task.id),
      })
    } else if (task.status === 'done') {
      resolveFailures({ ...base, resolvedAt: String(task.updated_at) })
    }
  }
  db.prepare(`
    UPDATE failure_records
    SET source_name = (
      SELECT COALESCE(NULLIF(ps.name, ''), NULLIF(ps.netease_playlist_name, ''), failure_records.source_name)
      FROM playlist_sources ps
      WHERE ps.id = failure_records.source_id
    )
    WHERE EXISTS (SELECT 1 FROM playlist_sources ps WHERE ps.id = failure_records.source_id)
      AND (source_name = '' OR source_name = source_id)
  `).run()
  db.prepare(`
    UPDATE failure_records
    SET run_type = (
      SELECT tr.type FROM task_runs tr WHERE tr.id = failure_records.run_id
    )
    WHERE run_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM task_runs tr WHERE tr.id = failure_records.run_id)
  `).run()
  const after = (db.prepare('SELECT COUNT(*) AS count FROM failure_records').get() as { count: number }).count
  return after - before
}
