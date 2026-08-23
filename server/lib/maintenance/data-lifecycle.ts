import type Database from 'better-sqlite3'
import type { SyncStrategyConfig } from '../config/types'
import { getDb } from '../db'
import type { JobStatus, TaskRunTrigger, TaskRunType } from '../job/types'

const DAY_MS = 24 * 60 * 60 * 1000

export const DATA_LIFECYCLE_LIMITS = {
  runDetailDays: 14,
  successfulRunDays: 7,
  failedRunDays: 30,
  downloadTaskDays: 30,
  resolvedFailureDays: 30,
  failureOccurrenceDays: 90,
  failureOccurrencesPerFingerprint: 50,
} as const

type RetentionConfig = Pick<
  SyncStrategyConfig,
  'jobRetentionSuccessDays' | 'jobRetentionFailedDays' | 'downloadTaskRetentionDays'
>

export interface DataLifecyclePolicy {
  runDetailDays: number
  successfulRunDays: number
  failedRunDays: number
  downloadTaskDays: number
  resolvedFailureDays: number
  failureOccurrenceDays: number
  failureOccurrencesPerFingerprint: number
}

export interface DataLifecycleResult {
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
    runDetailDays: DATA_LIFECYCLE_LIMITS.runDetailDays,
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
  type: TaskRunType
  trigger: TaskRunTrigger
  started_at: string
  finished_at: string | null
  status: JobStatus
  summary: string
  total_items: number
  success_items: number
  failed_items: number
  skipped_items: number
  removed_items: number
  warnings: number
  source: string
  target: string
  duration_ms: number
  data: string
}

function compactRunDetails(db: Database.Database, before: string, retainAfter: string): number {
  const rows = db.prepare(`
    SELECT id, type, trigger, started_at, finished_at, status, summary,
      total_items, success_items, failed_items, skipped_items, removed_items,
      warnings, source, target, duration_ms, data
    FROM task_runs
    WHERE status IN ('failed', 'partial')
      AND started_at < ?
      AND started_at >= ?
      AND json_valid(data) = 1
      AND COALESCE(json_extract(data, '$.detailsExpired'), 0) != 1
  `).all(before, retainAfter) as CompactableRunRow[]
  const update = db.prepare('UPDATE task_runs SET data = ? WHERE id = ?')
  let compacted = 0

  for (const row of rows) {
    try {
      const previous = JSON.parse(row.data) as { dryRun?: unknown; sourceIds?: unknown }
      const sourceIds = Array.isArray(previous.sourceIds)
        ? previous.sourceIds.filter((sourceId): sourceId is string => typeof sourceId === 'string')
        : []
      update.run(JSON.stringify({
        id: row.id,
        type: row.type,
        trigger: row.trigger,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        status: row.status,
        durationMs: row.duration_ms,
        summary: row.summary,
        source: row.source,
        sourceIds,
        target: row.target,
        totalSongs: row.total_items,
        successSongs: row.success_items,
        failedSongs: row.failed_items,
        skippedSongs: row.skipped_items,
        removedSongs: row.removed_items,
        warnings: row.warnings,
        dryRun: Boolean(previous.dryRun),
        steps: [],
        songs: [],
        config: {},
        detailsExpired: true,
      }), row.id)
      compacted += 1
    } catch {
      // A malformed historical payload remains queryable by its summary columns.
    }
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
    const compactedRuns = compactRunDetails(db, detailCutoff, failedRunCutoff)
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
      compactedRuns,
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
