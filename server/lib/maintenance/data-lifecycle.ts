import type Database from 'better-sqlite3'
import type { SyncStrategyConfig } from '../config/types'
import { getDb } from '../db'

const DAY_MS = 24 * 60 * 60 * 1000

export const DATA_LIFECYCLE_LIMITS = {
  logDays: 30,
  logMaxRows: 2000,
  runDetailDays: 7,
  runDetailMaxBytes: 8 * 1024 * 1024,
  successfulRunDays: 7,
  failedRunDays: 14,
  downloadTaskDays: 30,
  resolvedFailureDays: 30,
  failureOccurrenceDays: 90,
  failureOccurrencesPerFingerprint: 50,
} as const

type RetentionConfig = Pick<
  SyncStrategyConfig,
  'logRetentionDays' | 'jobRetentionSuccessDays' | 'jobRetentionFailedDays' | 'downloadTaskRetentionDays'
>

export interface DataLifecyclePolicy {
  logDays: number
  logMaxRows: number
  runDetailDays: number
  runDetailMaxBytes: number
  successfulRunDays: number
  failedRunDays: number
  downloadTaskDays: number
  resolvedFailureDays: number
  failureOccurrenceDays: number
  failureOccurrencesPerFingerprint: number
}

export interface DataLifecycleResult {
  deletedLogs: number
  compactedRuns: number
  deletedRuns: number
  clearedRunReferences: number
  deletedDownloadTasks: number
  prunedFailureTaskReferences: number
  deletedResolvedFailures: number
  deletedFailureOccurrences: number
}

function boundedDays(value: number | undefined, fallback: number, maximum: number): number {
  if (!Number.isInteger(value) || !value || value < 1) return fallback
  return Math.min(value, maximum)
}

export function resolveDataLifecyclePolicy(config: RetentionConfig): DataLifecyclePolicy {
  return {
    logDays: boundedDays(
      config.logRetentionDays,
      DATA_LIFECYCLE_LIMITS.logDays,
      DATA_LIFECYCLE_LIMITS.logDays,
    ),
    logMaxRows: DATA_LIFECYCLE_LIMITS.logMaxRows,
    runDetailDays: DATA_LIFECYCLE_LIMITS.runDetailDays,
    runDetailMaxBytes: DATA_LIFECYCLE_LIMITS.runDetailMaxBytes,
    successfulRunDays: boundedDays(
      config.jobRetentionSuccessDays,
      DATA_LIFECYCLE_LIMITS.successfulRunDays,
      DATA_LIFECYCLE_LIMITS.successfulRunDays,
    ),
    failedRunDays: boundedDays(
      config.jobRetentionFailedDays,
      DATA_LIFECYCLE_LIMITS.failedRunDays,
      DATA_LIFECYCLE_LIMITS.failedRunDays,
    ),
    downloadTaskDays: boundedDays(
      config.downloadTaskRetentionDays,
      DATA_LIFECYCLE_LIMITS.downloadTaskDays,
      DATA_LIFECYCLE_LIMITS.downloadTaskDays,
    ),
    resolvedFailureDays: DATA_LIFECYCLE_LIMITS.resolvedFailureDays,
    failureOccurrenceDays: DATA_LIFECYCLE_LIMITS.failureOccurrenceDays,
    failureOccurrencesPerFingerprint: DATA_LIFECYCLE_LIMITS.failureOccurrencesPerFingerprint,
  }
}

function cutoff(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString()
}

interface CompactableRunRow {
  id: string
  payload_bytes: number
}

function compactRunDetail(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM task_run_song_changes WHERE run_id = ?').run(id)
  db.prepare("UPDATE task_runs SET details_expired = 1, steps_json = '[]' WHERE id = ?").run(id)
}

function compactRunDetailsByAge(db: Database.Database, before: string, retainAfter: string): number {
  const rows = db.prepare(`
    SELECT id
    FROM task_runs
    WHERE status IN ('failed', 'partial')
      AND started_at < ?
      AND started_at >= ?
      AND details_expired = 0
  `).all(before, retainAfter) as Array<{ id: string }>
  for (const row of rows) compactRunDetail(db, row.id)
  return rows.length
}

/**
 * Time retention alone still grows quickly when a scheduler produces many
 * partial runs. Keep the newest valid detail payloads within a hard byte
 * budget and compact the older overflow to their indexed summary columns.
 */
function compactRunDetailsByBudget(db: Database.Database, maxBytes: number): number {
  const rows = db.prepare(`
    SELECT task_runs.id,
      LENGTH(CAST(task_runs.steps_json AS BLOB))
      + COALESCE(SUM(
        LENGTH(CAST(change.song_name AS BLOB))
        + LENGTH(CAST(change.artist AS BLOB))
        + LENGTH(CAST(change.album AS BLOB))
        + LENGTH(CAST(COALESCE(change.file_path, '') AS BLOB))
        + LENGTH(CAST(COALESCE(change.error_json, '') AS BLOB))
        + LENGTH(CAST(COALESCE(change.metadata_json, '') AS BLOB))
        + LENGTH(CAST(COALESCE(change.ops_json, '') AS BLOB))
      ), 0) AS payload_bytes
    FROM task_runs
    LEFT JOIN task_run_song_changes change ON change.run_id = task_runs.id
    WHERE task_runs.status != 'running'
      AND task_runs.details_expired = 0
    GROUP BY task_runs.id
    ORDER BY task_runs.started_at DESC, task_runs.id DESC
  `).all() as CompactableRunRow[]
  let retainedBytes = 0
  let retainedRows = 0
  let compacted = 0

  for (const row of rows) {
    const retain = retainedRows === 0 || retainedBytes + row.payload_bytes <= maxBytes
    if (retain) {
      retainedBytes += row.payload_bytes
      retainedRows += 1
      continue
    }
    compactRunDetail(db, row.id)
    compacted += 1
  }

  return compacted
}

function pruneFailureTaskReferences(db: Database.Database): number {
  const rows = db.prepare(`
    SELECT id, download_task_ids
    FROM failure_records
    WHERE download_task_ids IS NOT NULL AND TRIM(download_task_ids) != ''
  `).all() as Array<{ id: string; download_task_ids: string }>
  const taskExists = db.prepare('SELECT 1 FROM download_tasks WHERE id = ?')
  const update = db.prepare('UPDATE failure_records SET download_task_ids = ? WHERE id = ?')
  let pruned = 0

  for (const row of rows) {
    const current = row.download_task_ids.split(',').map(value => value.trim()).filter(Boolean)
    const retained = current.filter(taskId => Boolean(taskExists.get(taskId)))
    if (retained.length === current.length) continue
    update.run(retained.length > 0 ? retained.join(',') : null, row.id)
    pruned += current.length - retained.length
  }

  return pruned
}

export function runDataLifecycleMaintenance(
  config: RetentionConfig,
  db: Database.Database = getDb(),
  now = new Date(),
): DataLifecycleResult {
  const policy = resolveDataLifecyclePolicy(config)
  const detailCutoff = cutoff(now, policy.runDetailDays)
  const logCutoff = cutoff(now, policy.logDays)
  const successfulRunCutoff = cutoff(now, policy.successfulRunDays)
  const failedRunCutoff = cutoff(now, policy.failedRunDays)
  const downloadCutoff = cutoff(now, policy.downloadTaskDays)
  const resolvedFailureCutoff = cutoff(now, policy.resolvedFailureDays)
  const occurrenceCutoff = cutoff(now, policy.failureOccurrenceDays)
  const expiredRunWhere = `
    (status IN ('success', 'cancelled') AND started_at < ?)
    OR (status IN ('failed', 'partial') AND started_at < ?)
  `

  return db.transaction(() => {
    const deletedLogsByAge = db.prepare('DELETE FROM logs WHERE timestamp < ?').run(logCutoff).changes
    const logCount = (db.prepare('SELECT COUNT(*) AS count FROM logs').get() as { count: number }).count
    const overflowLogs = Math.max(0, logCount - policy.logMaxRows)
    const deletedLogsByCount = overflowLogs > 0
      ? db.prepare(`
          DELETE FROM logs
          WHERE id IN (SELECT id FROM logs ORDER BY timestamp ASC LIMIT ?)
        `).run(overflowLogs).changes
      : 0
    const compactedByAge = compactRunDetailsByAge(db, detailCutoff, failedRunCutoff)
    const runParams = [successfulRunCutoff, failedRunCutoff]
    const clearedSourceRuns = db.prepare(`
      UPDATE playlist_sources
      SET last_job_id = NULL
      WHERE last_job_id IN (SELECT id FROM task_runs WHERE ${expiredRunWhere})
    `).run(...runParams).changes
    const clearedFailureRuns = db.prepare(`
      UPDATE failure_records
      SET run_id = NULL
      WHERE run_id IN (SELECT id FROM task_runs WHERE ${expiredRunWhere})
    `).run(...runParams).changes
    const deletedRuns = db.prepare(`
      DELETE FROM task_runs
      WHERE ${expiredRunWhere}
    `).run(...runParams).changes
    const compactedByBudget = compactRunDetailsByBudget(db, policy.runDetailMaxBytes)
    const clearedStaleSourceRuns = db.prepare(`
      UPDATE playlist_sources
      SET last_job_id = NULL
      WHERE last_job_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM task_runs WHERE task_runs.id = playlist_sources.last_job_id)
    `).run().changes
    const clearedStaleFailureRuns = db.prepare(`
      UPDATE failure_records
      SET run_id = NULL
      WHERE run_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM task_runs WHERE task_runs.id = failure_records.run_id)
    `).run().changes

    const deletedDownloadTasks = db.prepare(`
      DELETE FROM download_tasks
      WHERE status IN ('done', 'failed')
        AND updated_at < ?
        AND NOT EXISTS (
          SELECT 1
          FROM failure_records
          WHERE status IN ('open', 'ignored')
            AND instr(
              ',' || COALESCE(download_task_ids, '') || ',',
              ',' || download_tasks.id || ','
            ) > 0
        )
    `).run(downloadCutoff).changes
    const prunedFailureTaskReferences = pruneFailureTaskReferences(db)

    db.prepare(`
      DELETE FROM failure_occurrences
      WHERE fingerprint IN (
        SELECT fingerprint
        FROM failure_records
        WHERE status = 'resolved'
          AND COALESCE(resolved_at, last_seen_at) < ?
      )
    `).run(resolvedFailureCutoff)
    const deletedResolvedFailures = db.prepare(`
      DELETE FROM failure_records
      WHERE status = 'resolved'
        AND COALESCE(resolved_at, last_seen_at) < ?
    `).run(resolvedFailureCutoff).changes

    const expiredOccurrences = db.prepare(`
      DELETE FROM failure_occurrences
      WHERE occurred_at < ?
    `).run(occurrenceCutoff).changes
    const overflowOccurrences = db.prepare(`
      DELETE FROM failure_occurrences
      WHERE rowid IN (
        SELECT rowid
        FROM (
          SELECT rowid,
            ROW_NUMBER() OVER (
              PARTITION BY fingerprint
              ORDER BY occurred_at DESC, occurrence_key DESC
            ) AS occurrence_rank
          FROM failure_occurrences
        ) ranked
        WHERE occurrence_rank > ?
      )
    `).run(policy.failureOccurrencesPerFingerprint).changes

    return {
      deletedLogs: deletedLogsByAge + deletedLogsByCount,
      compactedRuns: compactedByAge + compactedByBudget,
      deletedRuns,
      clearedRunReferences:
        clearedSourceRuns
        + clearedFailureRuns
        + clearedStaleSourceRuns
        + clearedStaleFailureRuns,
      deletedDownloadTasks,
      prunedFailureTaskReferences,
      deletedResolvedFailures,
      deletedFailureOccurrences: expiredOccurrences + overflowOccurrences,
    }
  })()
}

export function dataLifecycleChangeCount(result: DataLifecycleResult): number {
  return Object.values(result).reduce((total, value) => total + value, 0)
}
