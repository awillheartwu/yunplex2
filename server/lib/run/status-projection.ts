import type { getDb } from '../db'
import type { JobStatus, SourceRequestStatus, TaskRunType } from '../job/types'

type RunDatabase = ReturnType<typeof getDb>

export type TaskRunStatusRow = {
  id: string
  type: TaskRunType
  status: JobStatus
}

export type TaskRunDynamicFields = {
  awaitingSourceSync: boolean
  sourceRequestStatus: SourceRequestStatus | null
}

const awaitingActionSchemaSupport = new WeakMap<object, boolean>()

export function taskRunsSupportsAwaitingAction(db: RunDatabase): boolean {
  const cached = awaitingActionSchemaSupport.get(db)
  if (cached !== undefined) return cached

  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'task_runs'").get() as { sql?: string } | undefined
  const supported = Boolean(row?.sql?.includes('awaiting_action'))
  awaitingActionSchemaSupport.set(db, supported)
  return supported
}

function legacyAwaitingActionSql(alias: string): string {
  return `(
    ${alias}.type = 'source_initialization'
    AND ${alias}.status = 'partial'
    AND EXISTS (
      SELECT 1
      FROM source_initializations si
      WHERE si.run_id = ${alias}.id
        AND si.status = 'awaiting_review'
    )
  )`
}

export function projectTaskRunStatus(db: RunDatabase, row: TaskRunStatusRow): JobStatus {
  if (row.status !== 'partial' || row.type !== 'source_initialization') return row.status
  return db.prepare("SELECT 1 FROM source_initializations WHERE run_id = ? AND status = 'awaiting_review'").get(row.id)
    ? 'awaiting_action'
    : row.status
}

export function taskRunStatusFilterSql(status: JobStatus, alias = 'task_runs'): { sql: string; params: unknown[] } {
  if (status === 'awaiting_action') {
    return {
      sql: `(${alias}.status = 'awaiting_action' OR ${legacyAwaitingActionSql(alias)})`,
      params: [],
    }
  }

  if (status === 'partial') {
    return {
      sql: `(${alias}.status = ? AND NOT ${legacyAwaitingActionSql(alias)})`,
      params: ['partial'],
    }
  }

  return {
    sql: `${alias}.status = ?`,
    params: [status],
  }
}

export function projectTaskRunDynamicFields(db: RunDatabase, row: TaskRunStatusRow): TaskRunDynamicFields {
  const result = db.prepare(`
    SELECT
      CASE WHEN ? = 'manual_download' AND ? = 'success' AND EXISTS (
        SELECT 1
        FROM task_run_sources trs
        JOIN playlist_sources ps ON ps.id = trs.source_id
        WHERE trs.run_id = ? AND ps.requires_match_reconcile = 1
      ) THEN 1 ELSE 0 END AS awaiting_source_sync,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM source_sync_queue q
          WHERE q.run_id = ? AND q.status = 'running'
        ) THEN 'running'
        WHEN EXISTS (
          SELECT 1
          FROM source_sync_queue q
          WHERE q.run_id = ? AND q.status = 'pending'
        ) THEN 'pending'
        ELSE NULL
      END AS source_request_status
  `).get(row.type, row.status, row.id, row.id, row.id) as {
    awaiting_source_sync: number
    source_request_status: SourceRequestStatus | null
  }

  return {
    awaitingSourceSync: result.awaiting_source_sync === 1,
    sourceRequestStatus: result.source_request_status,
  }
}
