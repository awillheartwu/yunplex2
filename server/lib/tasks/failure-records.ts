import { randomUUID } from 'node:crypto'
import { getDb, readConfigFromDb } from '../db'
import type { TaskRunType } from '../job/types'
import { failureFingerprint, failureSubjectKey, normalizeFailureIdentityPart, plexRemovalTarget, type FailureSubject } from './failure-identity'
import { resolveDomainErrorDefinition } from '../../../shared/domain-errors'
import { sanitizeDiagnosticMessage } from '../domain-error'
import { rowToRecord, type FailureRecord, type FailureRecordStatus } from './failure-model'
import { hasCompletionEvidence, type CompletionEvidence } from './completion-evidence'
import { RETRYABLE_FAILURE_SQL, LEFT_SOURCE_SQL } from './recovery-targets'
import type { EnvironmentProblem } from './recovery-targets'

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
  // Timing stays in the run diagnostic; it must not split one cause into many groups.
  const failureReason = (sanitizeDiagnosticMessage(input.failureReason) || '').replace(/，耗时 \d+ ms/g, '')
  const normalizedInput = { ...input, failureKind: definition.code }
  const requestedFingerprint = failureFingerprint(normalizedInput)
  const subjectKey = failureSubjectKey(input)
  const current = input.downloadTaskId
    ? db.prepare(`SELECT * FROM failure_records WHERE subject_key=? AND status='open'
        AND INSTR(',' || COALESCE(download_task_ids,'') || ',', ',' || ? || ',')>0
        ORDER BY last_seen_at DESC LIMIT 1`).get(subjectKey, input.downloadTaskId) as Record<string, unknown> | undefined
    : !input.songId && !plexRemovalTarget(subjectKey)
      ? db.prepare("SELECT * FROM failure_records WHERE subject_key=? AND status='open' ORDER BY last_seen_at DESC LIMIT 1").get(subjectKey) as Record<string, unknown> | undefined
      : undefined
  const existing = current ?? db.prepare('SELECT * FROM failure_records WHERE fingerprint=?').get(requestedFingerprint) as Record<string, unknown> | undefined
  const fingerprint = existing ? String(existing.fingerprint) : requestedFingerprint
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
  if (existing) {
    const current = rowToRecord(existing, readConfigFromDb())
    const firstSeenAt = occurredAt < current.firstSeenAt ? occurredAt : current.firstSeenAt
    const lastSeenAt = occurredAt > current.lastSeenAt ? occurredAt : current.lastSeenAt
    const taskIds = new Set(current.downloadTaskIds)
    if (input.downloadTaskId) taskIds.add(input.downloadTaskId)
    const attemptCount = current.attemptCount + (isNewOccurrence ? 1 : 0)
    const status = current.status === 'ignored'
      ? 'ignored'
      : current.status === 'resolved' && !isNewOccurrence
        ? 'resolved'
        : 'open'
    const reason = failureReason
    db.prepare(`
      UPDATE failure_records
      SET song_id = ?, song_name = ?, artist = ?, source_id = ?, source_name = ?,
        run_id = ?, run_type = ?, failure_kind = ?, failure_reason = ?, status = ?,
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
      definition.code,
      reason,
      status,
      firstSeenAt,
      lastSeenAt,
      isNewOccurrence ? 1 : 0,
      current.occurrenceCount + (isNewOccurrence ? 1 : 0),
      [...taskIds].join(','),
      attemptCount,
      status === 'ignored' ? current.ignoreReason : null,
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
      'open',
      occurredAt,
      occurredAt,
      null,
      1,
      input.downloadTaskId || null,
      null,
    )
  }
  return rowToRecord(db.prepare(`SELECT fr.*, ps.enabled AS source_enabled, (${RETRYABLE_FAILURE_SQL}) AS retry_target_available, (${LEFT_SOURCE_SQL}) AS left_source
    FROM failure_records fr LEFT JOIN playlist_sources ps ON ps.id=fr.source_id WHERE fingerprint=?`).get(fingerprint) as Record<string, unknown>, readConfigFromDb())
}

export function resolveRecordedFailures(input: FailureSubject & {
  failureKinds?: string[]
  resolvedAt?: string
  includeIgnored?: boolean
  downloadTaskId?: string
  evidence?: CompletionEvidence
  failureIds?: string[]
}): number {
  if (input.failureIds && !input.failureIds.length) return 0
  const subject = failureSubjectKey(input)
  const resolvedAt = input.resolvedAt || new Date().toISOString()
  const params: unknown[] = [resolvedAt, subject, resolvedAt]
  let kindClause = ''
  if (input.failureKinds?.length) {
    kindClause = ` AND failure_kind IN (${input.failureKinds.map(() => '?').join(',')})`
    params.push(...input.failureKinds)
  }
  if (input.failureIds) {
    kindClause += ` AND id IN (${input.failureIds.map(() => '?').join(',')})`
    params.push(...input.failureIds)
  }
  const db = getDb()
  const rows = db.prepare(`SELECT id, download_task_ids, failure_kind, last_seen_at FROM failure_records
    WHERE subject_key = ? AND status IN (${input.includeIgnored ? "'open','ignored'" : "'open'"})
      AND last_seen_at <= ?${kindClause}`).all(...params.slice(1)) as Array<{
        id: string; download_task_ids: string | null; failure_kind: string; last_seen_at: string
      }>
  const update = db.prepare(`UPDATE failure_records SET status = 'resolved', resolved_at = ?,
    ignored_at = NULL, attempt_count = 0, ignore_reason = NULL WHERE id = ?`)
  let count = 0
  for (const row of rows) {
    if (!hasCompletionEvidence({ downloadTaskIds: (row.download_task_ids || '').split(',').filter(Boolean),
      failureKind: row.failure_kind, lastSeenAt: row.last_seen_at,
      evidence: input.evidence ?? 'identity', downloadTaskId: input.downloadTaskId })) continue
    count += update.run(resolvedAt, row.id).changes
  }
  return count
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

export function observeFailureSubject(subject: FailureSubject, runId: string, occurredAt = new Date().toISOString()): void {
  getDb().prepare(`INSERT OR IGNORE INTO failure_occurrences(fingerprint,occurrence_key,occurred_at)
    SELECT fingerprint,?,? FROM failure_records WHERE subject_key=? AND status IN ('open','ignored')`)
    .run(`run:${runId}`, occurredAt, failureSubjectKey(subject))
}

/** A successful probe may rearm only the exact unresolved attempts it inspected. */
export function rearmEnvironmentFailures(code: string, problems: readonly EnvironmentProblem[]): string[] {
  const update = getDb().prepare(`UPDATE failure_records SET attempt_count=0 WHERE id=? AND failure_kind=?
    AND status='open' AND last_seen_at=? AND occurrence_count=?`)
  return problems.flatMap(problem => update.run(problem.id, code, problem.lastSeenAt, problem.occurrenceCount).changes ? [problem.id] : [])
}

export function reopenFailuresForRetry(ids: string[]): void {
  setFailureRecordStatus(ids, 'open')
  incrementFailureRetries(ids)
}
