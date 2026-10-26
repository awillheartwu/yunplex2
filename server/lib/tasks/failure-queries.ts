import { getDb, readConfigFromDb } from '../db'
import { dateEndBoundary, dateStartBoundary } from '../date-range'
import { failureReasonGroupKey, failureSubjectKey, plexRemovalTarget } from './failure-identity'
import { recoveryDecision } from '../../../shared/error-recovery'
import type { RunFailureHandlingState } from '../../../shared/failure-handling'
import { failureDefinition, rowToRecord, type FailureRecord, type FailureRecordFilter, type FailureRecordStatus } from './failure-model'
import { RETRYABLE_FAILURE_SQL, LEFT_SOURCE_SQL } from './recovery-targets'

export interface SourceFailureCounts { actionable: number; copyrightRestricted: number }

const classifiedDatabases = new WeakSet<ReturnType<typeof getDb>>()

/** Apply the same classifier in SQL before filtering, grouping and pagination. */
function failureRecordSource(): string {
  const db = getDb()
  if (!classifiedDatabases.has(db)) {
    db.function('yunplex_failure_kind', { deterministic: true },
      (kind: string, reason: string | null) => failureDefinition(kind, reason).code)
    classifiedDatabases.add(db)
  }
  return `FROM (SELECT stored.*, yunplex_failure_kind(stored.failure_kind,stored.failure_reason) AS canonical_kind
    FROM failure_records stored) fr LEFT JOIN playlist_sources ps ON ps.id=fr.source_id`
}

export function getRetryFailureIds(
  sources: ReadonlyMap<string, ReadonlySet<number>>, removals: ReadonlyMap<string, ReadonlySet<string>>, taskIds: readonly string[],
): string[] {
  const selected = new Set<string>()
  for (const [sourceId, songs] of sources) {
    const songIds = [...songs], subjects = [...(removals.get(sourceId) ?? [])]
    const scope = ['subject_key=?', songIds.length ? `song_id IN (${songIds.map(() => '?').join(',')})` : '0=1',
      subjects.length ? `subject_key IN (${subjects.map(() => '?').join(',')})` : '0=1'].join(' OR ')
    const rows = getDb().prepare(`SELECT id FROM failure_records WHERE source_id=?
      AND (${scope}) AND status IN ('open','ignored')`)
      .all(sourceId, failureSubjectKey({ sourceId, songName: '来源同步' }), ...songIds, ...subjects) as { id: string }[]
    for (const row of rows) selected.add(row.id)
  }
  for (const taskId of taskIds) {
    const rows = getDb().prepare(`SELECT id FROM failure_records WHERE status IN ('open','ignored')
      AND INSTR(',' || COALESCE(download_task_ids,'') || ',', ',' || ? || ',')>0`).all(taskId) as { id: string }[]
    for (const row of rows) selected.add(row.id)
  }
  return [...selected]
}

export function getSourceFailureCounts(sourceId: string): SourceFailureCounts {
  const from = failureRecordSource()
  const row = getDb().prepare(`
    SELECT
      SUM(CASE WHEN fr.canonical_kind = 'copyright_restricted' THEN 1 ELSE 0 END) AS copyright_restricted,
      SUM(CASE
        WHEN fr.canonical_kind != 'copyright_restricted' AND fr.failure_kind != 'ignored_failure' THEN 1
        ELSE 0
      END) AS actionable
    ${from}
    WHERE fr.source_id = ? AND fr.status = 'open'
      AND (fr.song_id IS NULL OR NOT EXISTS (SELECT 1 FROM playlist_source_track_occurrences member
        WHERE member.source_id=fr.source_id AND member.netease_song_id=fr.song_id)
        OR EXISTS (SELECT 1 FROM playlist_source_track_occurrences member
        WHERE member.source_id=fr.source_id AND member.netease_song_id=fr.song_id AND member.membership_status='current'))
  `).get(sourceId) as { actionable: number | null; copyright_restricted: number | null }
  return {
    actionable: Number(row.actionable || 0),
    copyrightRestricted: Number(row.copyright_restricted || 0),
  }
}

export function buildFailureRecordQuery(filter: FailureRecordFilter = {}) {
  const from = failureRecordSource()
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
    conditions.push('fr.canonical_kind = ?')
    params.push(filter.failureKind)
  }
  if (filter.excludeFailureKinds?.length) {
    conditions.push(`fr.canonical_kind NOT IN (${filter.excludeFailureKinds.map(() => '?').join(',')})`)
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
    const group = getDb().prepare('SELECT yunplex_failure_kind(failure_kind,failure_reason) AS failure_kind, failure_reason FROM failure_records WHERE id = ?')
      .get(filter.groupId) as { failure_kind: string; failure_reason: string } | undefined
    if (group && (!filter.groupKey || filter.groupKey === failureReasonGroupKey(group.failure_kind, group.failure_reason))) {
      conditions.push('fr.canonical_kind = ?')
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
    SELECT fr.*, ps.enabled AS source_enabled, (${RETRYABLE_FAILURE_SQL}) AS retry_target_available, (${LEFT_SOURCE_SQL}) AS left_source,
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
  const config = readConfigFromDb()
  return {
    items: rows.map(row => rowToRecord(row, config)),
    total: counts.total,
    retryableTotal: counts.retryable_total,
    ignorableTotal: counts.ignorable_total,
    ignoredTotal: counts.ignored_total,
  }
}

export function getFailureRecords(ids: string[]): FailureRecord[] {
  if (ids.length === 0) return []
  const from = failureRecordSource()
  const rows = getDb().prepare(
    `SELECT fr.*,ps.enabled AS source_enabled,(${RETRYABLE_FAILURE_SQL}) AS retry_target_available,(${LEFT_SOURCE_SQL}) AS left_source
      ${from} WHERE fr.id IN (${ids.map(() => '?').join(',')})`,
  ).all(...ids) as Array<Record<string, unknown>>
  const config = readConfigFromDb()
  return rows.map(row => rowToRecord(row, config))
}

export function getRunFailureStates(runId: string): RunFailureHandlingState[] {
  const { where, from, params } = buildFailureRecordQuery({ runId, status: 'all' })
  const rows = getDb().prepare(`SELECT fr.subject_key,fr.source_id,fr.song_id,fr.status,fr.ignore_reason,
    fr.attempt_count,fr.failure_kind,fr.failure_reason,fr.last_seen_at,fr.run_type,ps.enabled AS source_enabled, (${RETRYABLE_FAILURE_SQL}) AS retry_target_available, (${LEFT_SOURCE_SQL}) AS left_source ${from} ${where}
    ORDER BY fr.status='open' DESC,fr.status='ignored' DESC,fr.last_seen_at DESC`).all(...params) as Array<{
      source_id: string | null; song_id: number | null; status: FailureRecordStatus; run_type: string; source_enabled: number | null; retry_target_available: number; left_source: number;
      subject_key: string;
      ignore_reason: 'automatic' | 'manual' | null; attempt_count: number; failure_kind: string; failure_reason: string; last_seen_at: string;
    }>
  const config = readConfigFromDb()
  const attemptLimit = Math.max(1, config.sync.maxFailureAttempts)
  return rows.map(row => ({
    sourceId: row.source_id, songId: row.song_id, status: row.status, ignoreReason: row.ignore_reason,
    ...plexRemovalTarget(row.subject_key),
    attemptCount: row.attempt_count, attemptLimit,
    automaticRecoveryEnabled: row.run_type !== 'sync' || (config.sync.enabled && row.source_enabled !== 0),
    retryable: Boolean(row.retry_target_available),
    notApplicable: Boolean(row.left_source),
    errorCode: failureDefinition(row.failure_kind, row.failure_reason).code,
    recovery: recoveryDecision({ errorCode: failureDefinition(row.failure_kind, row.failure_reason).code, status: row.status, attemptCount: row.attempt_count, attemptLimit, lastSeenAt: row.last_seen_at }),
  }))
}
