import Database from 'better-sqlite3'
import { getDb } from '../db'
import type { JobStatus, TaskRunType } from '../job/types'

export interface RunCleanupRequest {
  before: string
  type?: TaskRunType | ''
  status?: JobStatus | ''
}

export interface RunCleanupFilter {
  before: string
  type?: TaskRunType
  status?: JobStatus
}

export interface RunCleanupPreview {
  runCount: number
  downloadTaskCount: number
  linkedFailureCount: number
}

export interface RunCleanupResult extends RunCleanupPreview {
  count: number
}

const VALID_RUN_TYPES = new Set<TaskRunType>(['sync', 'repair', 'manual_download'])
const VALID_RUN_STATUSES = new Set<JobStatus>(['running', 'success', 'partial', 'failed', 'cancelled'])

export function parseRunCleanupRequest(body: RunCleanupRequest | null | undefined): { ok: true; filter: RunCleanupFilter } | { ok: false; message: string } {
  if (!body?.before || !/^\d{4}-\d{2}-\d{2}$/.test(body.before)) {
    return { ok: false, message: '请选择有效的清理日期' }
  }
  if (body.type && !VALID_RUN_TYPES.has(body.type)) {
    return { ok: false, message: '请选择有效的运行类型' }
  }
  if (body.status && !VALID_RUN_STATUSES.has(body.status)) {
    return { ok: false, message: '请选择有效的运行状态' }
  }
  if (body.status === 'running') {
    return { ok: false, message: '运行中的记录不能清理' }
  }
  return {
    ok: true,
    filter: {
      before: body.before,
      type: body.type || undefined,
      status: body.status || undefined,
    },
  }
}

function buildRunCleanupWhere(filter: RunCleanupFilter) {
  const conditions = ["started_at < ?", "status != 'running'"]
  const params: unknown[] = [`${filter.before}T00:00:00.000Z`]
  if (filter.type) {
    conditions.push('type = ?')
    params.push(filter.type)
  }
  if (filter.status) {
    conditions.push('status = ?')
    params.push(filter.status)
  }
  return { where: conditions.join(' AND '), params }
}

function getCleanupRunIds(db: Database.Database, filter: RunCleanupFilter): string[] {
  const { where, params } = buildRunCleanupWhere(filter)
  const rows = db.prepare(`SELECT id FROM task_runs WHERE ${where}`).all(...params) as Array<{ id: string }>
  return rows.map(row => row.id)
}

export function previewRunCleanup(filter: RunCleanupFilter, db: Database.Database = getDb()): RunCleanupPreview {
  const runIds = getCleanupRunIds(db, filter)
  if (runIds.length === 0) return { runCount: 0, downloadTaskCount: 0, linkedFailureCount: 0 }

  const placeholders = runIds.map(() => '?').join(',')
  const downloadTaskCount = (db.prepare(`
    SELECT COUNT(*) AS count
    FROM download_tasks
    WHERE COALESCE(run_id, job_id) IN (${placeholders})
      AND status IN ('done', 'failed')
  `).get(...runIds) as { count: number }).count
  const linkedFailureCount = (db.prepare(`
    SELECT COUNT(*) AS count
    FROM failure_records
    WHERE run_id IN (${placeholders})
  `).get(...runIds) as { count: number }).count

  return {
    runCount: runIds.length,
    downloadTaskCount,
    linkedFailureCount,
  }
}

export function cleanupRuns(filter: RunCleanupFilter, db: Database.Database = getDb()): RunCleanupResult {
  const runIds = getCleanupRunIds(db, filter)
  if (runIds.length === 0) {
    return { count: 0, runCount: 0, downloadTaskCount: 0, linkedFailureCount: 0 }
  }

  const preview = previewRunCleanup(filter, db)
  const placeholders = runIds.map(() => '?').join(',')
  const transaction = db.transaction(() => {
    db.prepare(`DELETE FROM task_runs WHERE id IN (${placeholders})`).run(...runIds)
    db.prepare(`
      DELETE FROM download_tasks
      WHERE COALESCE(run_id, job_id) IN (${placeholders})
        AND status IN ('done', 'failed')
    `).run(...runIds)
  })
  transaction()

  return { ...preview, count: runIds.length }
}
