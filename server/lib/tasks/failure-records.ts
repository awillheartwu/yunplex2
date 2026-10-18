import { randomUUID } from 'node:crypto'
import type { SongStatus, TaskRun, TaskRunType } from '../job/types'
import { getDb } from '../db'
import { dateEndBoundary, dateStartBoundary } from '../date-range'
import {
  failureFingerprint,
  failureReasonGroupKey,
  failureSubjectKey,
  normalizeFailureIdentityPart,
} from './failure-identity'
import type { DomainErrorCategory, DomainErrorCode, DomainErrorSeverity } from '../../../shared/domain-errors'
import { resolveDomainErrorDefinition } from '../../../shared/domain-errors'
import { sanitizeDiagnosticMessage } from '../domain-error'
import { canRetryFailure } from '../../../shared/failure-handling'

export { failureFingerprint, failureSubjectKey } from './failure-identity'

export type FailureRecordStatus = 'open' | 'paused' | 'ignored' | 'resolved'
export type FailureRecordStatusFilter = FailureRecordStatus | 'all'

export const RETRYABLE_FAILURE_SQL = `fr.status != 'resolved' AND (
  (fr.source_id IS NOT NULL AND fr.song_id IS NOT NULL)
  OR TRIM(COALESCE(fr.download_task_ids, '')) <> ''
)`

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
  errorCode: DomainErrorCode
  errorCategory: DomainErrorCategory
  errorSeverity: DomainErrorSeverity
  retryable: boolean
  userMessage: string
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
  status?: FailureRecordStatusFilter
  type?: TaskRunType
  failureKind?: string
  excludeFailureKinds?: string[]
  sourceId?: string
  runId?: string
  groupId?: string
  groupKey?: string
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
  status: 'open' | 'ignored' | 'paused'
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

const LEGACY_FAILURE_KINDS: DomainErrorCode[] = ['failed_download', 'filesystem_failed', 'validation_failed']
const SPECIFIC_FAILURE_KINDS = new Set<DomainErrorCode>([
  'source_unavailable',
  'source_missing',
  'invalid_audio',
  'unsupported_format',
])

function rowToRecord(row: Record<string, unknown>): FailureRecord {
  const rawFirstSeenAt = String(row.first_seen_at)
  const rawLastSeenAt = String(row.last_seen_at)
  const firstSeenAt = rawFirstSeenAt <= rawLastSeenAt ? rawFirstSeenAt : rawLastSeenAt
  const lastSeenAt = rawFirstSeenAt <= rawLastSeenAt ? rawLastSeenAt : rawFirstSeenAt

  const failureKind = String(row.failure_kind)
  const failureReason = sanitizeDiagnosticMessage(row.failure_reason) || ''
  const definition = resolveDomainErrorDefinition(failureKind, failureReason)
  const status = String(row.status) as FailureRecordStatus
  const sourceId = row.source_id === null ? null : String(row.source_id)
  const songId = row.song_id === null ? null : Number(row.song_id)
  const downloadTaskIds = String(row.download_task_ids || '').split(',').filter(Boolean)
  return {
    id: String(row.id),
    fingerprint: String(row.fingerprint),
    subjectKey: String(row.subject_key),
    songId,
    songName: String(row.song_name),
    artist: String(row.artist || ''),
    sourceId,
    sourceName: String(row.source_name || ''),
    runId: row.run_id === null ? null : String(row.run_id),
    runType: String(row.run_type) as TaskRunType,
    failureKind,
    failureReason,
    errorCode: definition.code,
    errorCategory: definition.category,
    errorSeverity: definition.severity,
    retryable: canRetryFailure({ status, sourceId, songId, downloadTaskIds }),
    userMessage: definition.userMessage,
    status,
    firstSeenAt,
    lastSeenAt,
    ignoredAt: row.ignored_at === null ? null : String(row.ignored_at),
    resolvedAt: row.resolved_at === null ? null : String(row.resolved_at),
    occurrenceCount: Number(row.occurrence_count),
    retryCount: Number(row.retry_count),
    downloadTaskIds,
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
  const definition = resolveDomainErrorDefinition(input.failureKind, input.failureReason)
  if (SPECIFIC_FAILURE_KINDS.has(definition.code)) {
    // Reclassifying a legacy failure must not leave a second open record for
    // the same song. Older generic kinds are superseded by the specific cause.
    resolveFailures({
      songId: input.songId,
      songName: input.songName,
      artist: input.artist,
      sourceId: input.sourceId,
      failureKinds: LEGACY_FAILURE_KINDS,
      resolvedAt: occurredAt,
    })
  }
  // Timing stays in the run diagnostic; it must not split one cause into many groups.
  const failureReason = (sanitizeDiagnosticMessage(input.failureReason) || '').replace(/，耗时 \d+ ms/g, '')
  const normalizedInput = { ...input, failureKind: definition.code }
  const fingerprint = failureFingerprint(normalizedInput)
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
      : current.status === 'paused'
        ? 'paused'
      : current.status === 'resolved' && !isNewOccurrence
        ? 'resolved'
        : 'open'
    const reason = failureReason
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
      definition.code,
      failureReason,
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
    WHERE subject_key = ? AND status IN ('open','paused') AND last_seen_at <= ?${kindClause}
  `).run(...params)
  return result.changes
}

export function reconcileRunFailures(run: TaskRun): void {
  for (const song of run.songs || []) {
    const sourceName = song.sourceId || run.source
    if (FAILURE_STATUSES.has(song.status)) {
      if (song.status === 'copyright_restricted') {
        resolveFailures({
          songId: song.neteaseSongId,
          songName: song.songName,
          artist: song.artist,
          sourceId: song.sourceId,
          resolvedAt: run.finishedAt || new Date().toISOString(),
        })
      }
      recordFailure({
        songId: song.neteaseSongId,
        songName: song.songName,
        artist: song.artist,
        sourceId: song.sourceId,
        sourceName,
        runId: run.id,
        runType: run.type,
        failureKind: song.error?.code ?? song.status,
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
  // A newly approved replacement can proceed without deleting older failure history.
  const rows = getDb().prepare(`
    SELECT song_id, failure_kind, occurrence_count, last_seen_at, status
    FROM failure_records
    WHERE source_id = ?
      AND status IN ('open', 'ignored', 'paused')
      AND song_id IS NOT NULL
      AND failure_kind != 'ignored_failure'
      AND NOT EXISTS (
        SELECT 1 FROM media_corrections correction
        WHERE correction.song_id = failure_records.song_id
          AND correction.status IN ('pending', 'ready')
          AND correction.updated_at > failure_records.last_seen_at
      )
    ORDER BY last_seen_at DESC
  `).all(sourceId) as Array<{
    song_id: number
    failure_kind: string
    occurrence_count: number
    last_seen_at: string
    status: 'open' | 'ignored' | 'paused'
  }>
  const copyrightSongIds = new Set<number>()
  const failuresBySongId: Record<number, SourceFailurePolicyEntry> = {}

  for (const row of rows) {
    if (row.failure_kind === 'copyright_restricted') {
      copyrightSongIds.add(row.song_id)
    }
    if (failuresBySongId[row.song_id]) continue
    failuresBySongId[row.song_id] = {
      failureKind: row.failure_kind,
      occurrenceCount: row.occurrence_count,
      status: row.status,
      phase: phaseForFailureKind(row.failure_kind),
    }
  }

  return { copyrightSongIds: [...copyrightSongIds], failuresBySongId }
}

export function shouldPauseSourceFailure(
  entry: SourceFailurePolicyEntry | undefined,
  maxFailures: number,
): boolean {
  if (!entry) return false
  return !resolveDomainErrorDefinition(entry.failureKind).retryable
    || (maxFailures > 0 && entry.occurrenceCount >= maxFailures)
}

/** Whether this failure is known/terminal and must not force another full pass. */
export function isTerminalFailure(
  entry: SourceFailurePolicyEntry | undefined,
  maxFailures: number,
): boolean {
  if (!entry) return false
  if (entry.status === 'ignored' || entry.status === 'paused') return true
  return shouldPauseSourceFailure(entry, maxFailures)
}

/** Move exhausted automatic failures to the paused state without hiding them. */
export function pauseExhaustedFailures(sourceId: string, maxFailures: number): number {
  const rows = getDb().prepare(`
    SELECT id, failure_kind, occurrence_count
    FROM failure_records
    WHERE source_id = ? AND status = 'open'
  `).all(sourceId) as Array<{ id: string; failure_kind: string; occurrence_count: number }>
  const update = getDb().prepare("UPDATE failure_records SET status = 'paused', ignored_at = NULL WHERE id = ? AND status = 'open'")
  let paused = 0
  for (const row of rows) {
    const phase = phaseForFailureKind(row.failure_kind)
    const exhausted = shouldPauseSourceFailure({
      failureKind: row.failure_kind, phase, occurrenceCount: row.occurrence_count, status: 'open',
    }, maxFailures)
    if (exhausted && update.run(row.id).changes > 0) paused++
  }
  return paused
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
    WHERE source_id = ? AND status IN ('open', 'paused')
  `).get(sourceId) as { actionable: number | null; copyright_restricted: number | null }
  return {
    actionable: Number(row.actionable || 0),
    copyrightRestricted: Number(row.copyright_restricted || 0),
  }
}

export function buildFailureRecordQuery(filter: FailureRecordFilter = {}) {
  const conditions: string[] = []
  const params: unknown[] = []
  if (filter.status === 'all') {
    conditions.push("fr.status IN ('open','paused','ignored','resolved')")
  } else {
    conditions.push('fr.status = ?')
    params.push(filter.status || 'open')
  }
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
  if (filter.runId) {
    conditions.push(`(fr.run_id = ? OR EXISTS (
      SELECT 1 FROM failure_occurrences fo
      WHERE fo.fingerprint = fr.fingerprint AND fo.occurrence_key = ?
    ))`)
    params.push(filter.runId, `run:${filter.runId}`)
  }
  if (filter.groupId) {
    const group = getDb().prepare('SELECT failure_kind, failure_reason FROM failure_records WHERE id = ?')
      .get(filter.groupId) as { failure_kind: string; failure_reason: string } | undefined
    if (group && (!filter.groupKey || filter.groupKey === failureReasonGroupKey(group.failure_kind, group.failure_reason))) {
      conditions.push('fr.failure_kind = ?')
      params.push(group.failure_kind)
      if (group.failure_kind !== 'copyright_restricted') {
        conditions.push('fr.failure_reason = ?')
        params.push(group.failure_reason)
      }
    } else conditions.push('0 = 1')
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
  const from = 'FROM failure_records fr LEFT JOIN playlist_sources ps ON ps.id = fr.source_id'
  return { where, from, params }
}

export function queryFailureRecords(filter: FailureRecordFilter = {}): {
  items: FailureRecord[]
  total: number
  retryableTotal: number
  ignorableTotal: number
} {
  const { where, from, params } = buildFailureRecordQuery(filter)
  const db = getDb()
  const counts = db.prepare(`
    SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN ${RETRYABLE_FAILURE_SQL} THEN 1 ELSE 0 END), 0) AS retryable_total,
      COALESCE(SUM(CASE WHEN fr.status IN ('open', 'paused') THEN 1 ELSE 0 END), 0) AS ignorable_total
    ${from} ${where}
  `).get(...params) as { total: number; retryable_total: number; ignorable_total: number }
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
  return {
    items: rows.map(rowToRecord),
    total: counts.total,
    retryableTotal: counts.retryable_total,
    ignorableTotal: counts.ignorable_total,
  }
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
