import { randomUUID } from 'node:crypto'
import type { SongStatus, TaskRun, TaskRunType } from '../job/types'
import { getDb, readConfigFromDb } from '../db'
import { dateEndBoundary, dateStartBoundary } from '../date-range'
import {
  failureFingerprint,
  failureReasonGroupKey,
  failureSubjectKey,
  normalizeFailureIdentityPart,
  plexRemovalTarget,
} from './failure-identity'
import type { FailureSubject } from './failure-identity'
import type { DomainErrorCategory, DomainErrorCode, DomainErrorSeverity } from '../../../shared/domain-errors'
import { resolveDomainErrorDefinition } from '../../../shared/domain-errors'
import { sanitizeDiagnosticMessage } from '../domain-error'
import { canRetryFailure } from '../../../shared/failure-handling'
import type { RunFailureHandlingState } from '../../../shared/failure-handling'

export { failureFingerprint, failureSubjectKey } from './failure-identity'

export type FailureRecordStatus = 'open' | 'ignored' | 'resolved'
export type FailureRecordStatusFilter = FailureRecordStatus | 'all'

export const RETRYABLE_FAILURE_SQL = `fr.status != 'resolved' AND (
  fr.source_id IS NOT NULL
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
  attemptCount: number
  attemptLimit: number
  ignoreReason: 'automatic' | 'manual' | null
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
  attemptCount: number
  status: 'open' | 'ignored'
  phase: 'download' | 'tags' | 'plex_match' | 'plex_insert'
}

export interface SourceFailurePolicy {
  failuresBySongId: Record<number, SourceFailurePolicyEntry>
  removalFailures: Record<string, SourceFailurePolicyEntry>
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
    attemptCount: Number(row.attempt_count),
    attemptLimit: readConfigFromDb().sync.maxFailureAttempts,
    ignoreReason: row.ignore_reason === 'automatic' || row.ignore_reason === 'manual' ? row.ignore_reason : null,
    retryCount: Number(row.retry_count),
    downloadTaskIds,
  }
}

export function recordFailure(input: FailureSubject & {
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
  const maxAttempts = readConfigFromDb().sync.maxFailureAttempts
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
  const downloadAttempt = input.downloadTaskId
    ? db.prepare('SELECT retry_count FROM download_tasks WHERE id = ?').get(input.downloadTaskId) as { retry_count: number } | undefined
    : undefined
  const occurrenceKey = downloadAttempt
    ? `download:${input.downloadTaskId}:${downloadAttempt.retry_count}`
    : input.runId
      ? `run:${input.runId}`
      : input.downloadTaskId
        ? `download:${input.downloadTaskId}`
        : `event:${occurredAt}:${normalizeFailureIdentityPart(input.failureReason)}`
  const occurrenceResult = db.prepare(`
    INSERT OR IGNORE INTO failure_occurrences (fingerprint, occurrence_key, occurred_at)
    VALUES (?, ?, ?)
  `).run(fingerprint, occurrenceKey, occurredAt)
  const isNewOccurrence = occurrenceResult.changes > 0
  if (downloadAttempt && input.runId) {
    db.prepare('INSERT OR IGNORE INTO failure_occurrences (fingerprint, occurrence_key, occurred_at) VALUES (?, ?, ?)')
      .run(fingerprint, `run:${input.runId}`, occurredAt)
  }
  const existing = db.prepare('SELECT * FROM failure_records WHERE fingerprint = ?').get(fingerprint) as Record<string, unknown> | undefined
  if (existing) {
    const current = rowToRecord(existing)
    const firstSeenAt = occurredAt < current.firstSeenAt ? occurredAt : current.firstSeenAt
    const lastSeenAt = occurredAt > current.lastSeenAt ? occurredAt : current.lastSeenAt
    const taskIds = new Set(current.downloadTaskIds)
    if (input.downloadTaskId) taskIds.add(input.downloadTaskId)
    const attemptCount = current.attemptCount + (isNewOccurrence ? 1 : 0)
    const autoIgnore = isNewOccurrence && (!definition.retryable || attemptCount >= maxAttempts)
    const status = current.status === 'ignored' || autoIgnore
      ? 'ignored'
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
        occurrence_count = ?, download_task_ids = ?, attempt_count = ?,
        ignore_reason = ?, ignored_at = CASE WHEN ? = 'ignored' THEN COALESCE(ignored_at, ?) ELSE NULL END
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
      attemptCount,
      status === 'ignored' ? current.ignoreReason ?? 'automatic' : null,
      status,
      occurredAt,
      fingerprint,
    )
  } else {
    db.prepare(`
      INSERT INTO failure_records (
        id, fingerprint, subject_key, song_id, song_name, artist, source_id,
        source_name, run_id, run_type, failure_kind, failure_reason, status,
        first_seen_at, last_seen_at, ignored_at, resolved_at,
        occurrence_count, retry_count, download_task_ids, attempt_count, ignore_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 0, ?, 1, ?)
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
      !definition.retryable || maxAttempts <= 1 ? 'ignored' : 'open',
      occurredAt,
      occurredAt,
      !definition.retryable || maxAttempts <= 1 ? occurredAt : null,
      1,
      input.downloadTaskId || null,
      !definition.retryable || maxAttempts <= 1 ? 'automatic' : null,
    )
  }
  return rowToRecord(db.prepare('SELECT * FROM failure_records WHERE fingerprint = ?').get(fingerprint) as Record<string, unknown>)
}

export function resolveFailures(input: FailureSubject & {
  failureKinds?: string[]
  resolvedAt?: string
  includeIgnored?: boolean
  downloadTaskId?: string
}): number {
  const subject = failureSubjectKey(input)
  const resolvedAt = input.resolvedAt || new Date().toISOString()
  const params: unknown[] = [resolvedAt, subject, resolvedAt]
  let kindClause = ''
  if (input.failureKinds?.length) {
    kindClause = ` AND failure_kind IN (${input.failureKinds.map(() => '?').join(',')})`
    params.push(...input.failureKinds)
  }
  if (input.downloadTaskId) {
    kindClause += " AND INSTR(',' || COALESCE(download_task_ids, '') || ',', ',' || ? || ',') > 0"
    params.push(input.downloadTaskId)
  }
  const result = getDb().prepare(`
    UPDATE failure_records
    SET status = 'resolved', resolved_at = ?, ignored_at = NULL, attempt_count = 0, ignore_reason = NULL
    WHERE subject_key = ? AND status IN (${input.includeIgnored ? "'open','ignored'" : "'open'"}) AND last_seen_at <= ?${kindClause}
      AND NOT EXISTS (
        SELECT 1 FROM download_tasks task
        WHERE INSTR(',' || COALESCE(failure_records.download_task_ids, '') || ',', ',' || task.id || ',') > 0
          AND task.status != 'done'
          AND (task.operation IN ('repair_existing', 'replace')
            OR json_extract(task.execution_intent_json, '$.downloadMode') = 'replace'
            OR failure_records.failure_kind = 'failed_tags')
          AND NOT EXISTS (
            SELECT 1 FROM download_tasks completed
            WHERE completed.song_id = task.song_id AND completed.status = 'done'
              AND (completed.file_path = COALESCE(task.file_path, task.target_path)
                OR completed.idempotency_key = task.idempotency_key)
              AND completed.updated_at >= failure_records.last_seen_at
              AND CASE
                WHEN task.operation = 'replace' OR json_extract(task.execution_intent_json, '$.downloadMode') = 'replace'
                THEN completed.operation = 'replace' OR json_extract(completed.execution_intent_json, '$.downloadMode') = 'replace'
                ELSE json_extract(completed.execution_intent_json, '$.embedMetadata') = 1
              END
          )
      )
  `).run(...params)
  return result.changes
}

export function reconcileRunFailures(run: TaskRun): void {
  for (const song of run.songs || []) {
    const sourceName = song.sourceId || run.source
    const subject: FailureSubject = {
      songId: song.neteaseSongId, songName: song.songName, artist: song.artist, sourceId: song.sourceId,
      plexPlaylistRatingKey: song.metadata?.plexPlaylistRatingKey,
      plexPlaylistItemId: song.metadata?.plexPlaylistItemId,
    }
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
    } else if (song.status === 'ignored_failure') {
      // Observing an ignored problem links this run without recording another failure.
      getDb().prepare(`INSERT OR IGNORE INTO failure_occurrences (fingerprint, occurrence_key, occurred_at)
        SELECT fingerprint, ?, ? FROM failure_records WHERE subject_key = ? AND status = 'ignored'`)
        .run(`run:${run.id}`, run.finishedAt || new Date().toISOString(), failureSubjectKey(subject))
    } else if (song.status === 'success' || song.status === 'skipped_existing' || song.status === 'removed') {
      resolveFailures({
        ...subject,
        includeIgnored: song.status === 'removed',
        resolvedAt: run.finishedAt || new Date().toISOString(),
      })
    }
  }
}

export function getSourceFailureStatus(sourceId: string): 'open' | 'ignored' | null {
  const row = getDb().prepare(`SELECT status FROM failure_records WHERE subject_key = ?
    AND status IN ('open', 'ignored') ORDER BY status = 'open' ASC LIMIT 1`)
    .get(failureSubjectKey({ sourceId, songName: '来源同步' })) as { status: 'open' | 'ignored' } | undefined
  return row?.status ?? null
}

export function reopenIgnoredSourceFailures(sourceId: string): number {
  const rows = getDb().prepare("SELECT id FROM failure_records WHERE subject_key = ? AND status = 'ignored'")
    .all(failureSubjectKey({ sourceId, songName: '来源同步' })) as { id: string }[]
  const ids = rows.map(row => row.id)
  const count = setFailureRecordStatus(ids, 'open')
  incrementFailureRetries(ids)
  return count
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
    SELECT subject_key, song_id, failure_kind, occurrence_count, attempt_count, last_seen_at, status
    FROM failure_records
    WHERE source_id = ?
      AND status IN ('open', 'ignored')
      AND failure_kind != 'ignored_failure'
      AND NOT EXISTS (
        SELECT 1 FROM media_corrections correction
        WHERE correction.song_id = failure_records.song_id
          AND correction.status IN ('pending', 'ready')
          AND correction.updated_at > failure_records.last_seen_at
      )
    ORDER BY status = 'ignored' DESC, last_seen_at DESC
  `).all(sourceId) as Array<{
    subject_key: string
    song_id: number | null
    failure_kind: string
    occurrence_count: number
    attempt_count: number
    last_seen_at: string
    status: 'open' | 'ignored'
  }>
  const failuresBySongId: Record<number, SourceFailurePolicyEntry> = {}
  const removalFailures: Record<string, SourceFailurePolicyEntry> = {}

  for (const row of rows) {
    const entry: SourceFailurePolicyEntry = {
      failureKind: row.failure_kind,
      occurrenceCount: row.occurrence_count,
      attemptCount: row.attempt_count,
      status: row.status,
      phase: phaseForFailureKind(row.failure_kind),
    }
    if (row.song_id !== null) failuresBySongId[row.song_id] ??= entry
    else if (plexRemovalTarget(row.subject_key)) removalFailures[row.subject_key] ??= entry
  }

  return { failuresBySongId, removalFailures }
}

/** A missing concrete item is already removed; an ignored present item stays untouched. */
export function observePlexRemovalFailures(input: {
  sourceId: string
  playlistRatingKey: string
  currentItemIds: ReadonlySet<number>
  maxFailureAttempts: number
}): Set<number> {
  const ignored = new Set<number>()
  for (const [subject, failure] of Object.entries(getSourceFailurePolicy(input.sourceId).removalFailures)) {
    const target = plexRemovalTarget(subject)!
    if (target.plexPlaylistRatingKey !== input.playlistRatingKey) continue
    if (!input.currentItemIds.has(target.plexPlaylistItemId)) {
      resolveFailures({ ...target, sourceId: input.sourceId, songName: '', includeIgnored: true })
    } else if (isTerminalFailure(failure, input.maxFailureAttempts)) {
      ignored.add(target.plexPlaylistItemId)
    }
  }
  return ignored
}

export function shouldIgnoreSourceFailure(
  entry: SourceFailurePolicyEntry | undefined,
  maxFailures: number,
): boolean {
  if (!entry || entry.attemptCount === 0) return false
  return !resolveDomainErrorDefinition(entry.failureKind).retryable
    || (maxFailures > 0 && entry.attemptCount >= maxFailures)
}

/** Whether this failure is known/terminal and must not force another full pass. */
export function isTerminalFailure(
  entry: SourceFailurePolicyEntry | undefined,
  maxFailures: number,
): boolean {
  if (!entry) return false
  if (entry.status === 'ignored') return true
  return shouldIgnoreSourceFailure(entry, maxFailures)
}

/** Stop automatic processing at the configured limit; only an explicit retry reopens it. */
export function ignoreExhaustedFailures(sourceId: string, maxFailures: number): number {
  const rows = getDb().prepare(`
    SELECT id, failure_kind, occurrence_count, attempt_count
    FROM failure_records
    WHERE source_id = ? AND status = 'open'
  `).all(sourceId) as Array<{ id: string; failure_kind: string; occurrence_count: number; attempt_count: number }>
  const update = getDb().prepare("UPDATE failure_records SET status = 'ignored', ignore_reason = 'automatic', ignored_at = ? WHERE id = ? AND status = 'open'")
  let ignored = 0
  for (const row of rows) {
    const phase = phaseForFailureKind(row.failure_kind)
    const exhausted = shouldIgnoreSourceFailure({
      failureKind: row.failure_kind, phase, occurrenceCount: row.occurrence_count, attemptCount: row.attempt_count, status: 'open',
    }, maxFailures)
    if (exhausted && update.run(new Date().toISOString(), row.id).changes > 0) ignored++
  }
  return ignored
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

export function buildFailureRecordQuery(filter: FailureRecordFilter = {}) {
  const conditions: string[] = []
  const params: unknown[] = []
  if (filter.status === 'all') {
    conditions.push("fr.status IN ('open','ignored','resolved')")
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
  ignoredTotal: number
} {
  const { where, from, params } = buildFailureRecordQuery(filter)
  const db = getDb()
  const counts = db.prepare(`
    SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN ${RETRYABLE_FAILURE_SQL} THEN 1 ELSE 0 END), 0) AS retryable_total,
      COALESCE(SUM(CASE WHEN fr.status = 'open' THEN 1 ELSE 0 END), 0) AS ignorable_total,
      COALESCE(SUM(CASE WHEN fr.status = 'ignored' THEN 1 ELSE 0 END), 0) AS ignored_total
    ${from} ${where}
  `).get(...params) as { total: number; retryable_total: number; ignorable_total: number; ignored_total: number }
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
    ignoredTotal: counts.ignored_total,
  }
}

export function getFailureRecords(ids: string[]): FailureRecord[] {
  if (ids.length === 0) return []
  const rows = getDb().prepare(
    `SELECT * FROM failure_records WHERE id IN (${ids.map(() => '?').join(',')})`,
  ).all(...ids) as Array<Record<string, unknown>>
  return rows.map(rowToRecord)
}

export function getRunFailureStates(runId: string): RunFailureHandlingState[] {
  const { where, from, params } = buildFailureRecordQuery({ runId, status: 'all' })
  const rows = getDb().prepare(`SELECT fr.subject_key,fr.source_id,fr.song_id,fr.status,fr.ignore_reason,
    fr.attempt_count,fr.failure_kind,fr.failure_reason ${from} ${where}
    ORDER BY fr.status='open' DESC,fr.status='ignored' DESC,fr.last_seen_at DESC`).all(...params) as Array<{
      source_id: string | null; song_id: number | null; status: FailureRecordStatus;
      subject_key: string;
      ignore_reason: 'automatic' | 'manual' | null; attempt_count: number; failure_kind: string; failure_reason: string;
    }>
  const attemptLimit = Math.max(1, readConfigFromDb().sync.maxFailureAttempts)
  return rows.map(row => ({
    sourceId: row.source_id, songId: row.song_id, status: row.status, ignoreReason: row.ignore_reason,
    ...plexRemovalTarget(row.subject_key),
    attemptCount: row.attempt_count, attemptLimit,
    errorCode: resolveDomainErrorDefinition(row.failure_kind, row.failure_reason).code,
  }))
}

export function setFailureRecordStatus(ids: string[], status: FailureRecordStatus): number {
  if (ids.length === 0) return 0
  const now = new Date().toISOString()
  const result = getDb().prepare(`
    UPDATE failure_records
    SET status = ?,
      attempt_count = CASE WHEN ? = 'open' OR ? = 'resolved' THEN 0 ELSE attempt_count END,
      ignore_reason = CASE WHEN ? = 'ignored' THEN 'manual' ELSE NULL END,
      ignored_at = CASE WHEN ? = 'ignored' THEN ? ELSE NULL END,
      resolved_at = CASE WHEN ? = 'resolved' THEN ? WHEN ? = 'open' THEN NULL ELSE resolved_at END
    WHERE id IN (${ids.map(() => '?').join(',')})
  `).run(status, status, status, status, status, now, status, now, status, ...ids)
  return result.changes
}

export function incrementFailureRetries(ids: string[]): number {
  if (ids.length === 0) return 0
  return getDb().prepare(
    `UPDATE failure_records SET retry_count = retry_count + 1 WHERE id IN (${ids.map(() => '?').join(',')})`,
  ).run(...ids).changes
}
