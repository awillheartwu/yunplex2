import { getQueueStatus } from './queue-status'
export { getQueueStatus } from './queue-status'
import { AWAITING_SOURCE_SYNC_PROJECTION } from './task-status-projection'
import { randomUUID } from 'node:crypto'
import { getDb } from '../db'
import { createFileTaskSchema, listFileTaskRuns } from '../db/file-task-schema'
import { emitEvent } from '../sync/events'
import { recordFailure, resolveFailures } from '../tasks/failure-records'
import { getRun, syncManualDownloadRun, syncRepairRun } from '../run/store'
import { updateSource } from '../playlist/store'
import { dateEndBoundary, dateKeyInTimeZone, dateStartBoundary } from '../date-range'
import { classifyDomainErrorCode } from '../../../shared/domain-errors'
import { ELIGIBLE_DOWNLOAD_CALLERS_SQL, getDownloadQueueControl } from './queue-control'

export interface DownloadTask {
  id: string
  sourceId: string | null
  sourceName?: string
  songId: number
  songName: string
  artist: string
  album: string
  status: 'pending' | 'downloading' | 'tagging' | 'done' | 'failed'
  progress: number
  filePath?: string
  fileType?: string
  quality?: string
  error?: string
  retryCount: number
  autoRetryCount?: number
  nextAttemptAt?: string
  jobId?: string
  idempotencyKey?: string
  operation?: DownloadTaskOperation
  targetPath?: string
  executionIntent?: DownloadExecutionIntent
  /** Derived from the task's source and current Playlist Source state. */
  awaitingSourceSync?: boolean
  createdAt: string
  updatedAt: string
}

export type DownloadTaskOperation = 'download' | 'replace' | 'managed_copy' | 'repair_existing'
export interface DownloadExecutionIntent {
  downloadMode?: 'full' | 'missing' | 'replace'
  target?:
    | { kind: 'computed'; protectedPath?: string; requireManagedCopy?: boolean }
    | { kind: 'existing'; path: string }
  downloadLyrics?: boolean
  embedMetadata?: boolean
  embedCover?: boolean
}
const DOWNLOAD_TASK_OPERATIONS = new Set<DownloadTaskOperation>([
  'download',
  'replace',
  'managed_copy',
  'repair_existing',
])


export interface QueueStatus {
  pending: number
  downloading: number
  tagging: number
  done: number
  failed: number
  total: number
}

export const DOWNLOAD_TASK_INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000
export const DOWNLOAD_TASK_LEASE_MS = 10 * 60 * 1000

export interface ProcessDownloadQueueOptions {
  automaticRetries?: boolean
  inactivityTimeoutMs?: number
  leaseDurationMs?: number
  shouldStop?: () => boolean
  onTaskSettled?: (
    task: DownloadTask,
    outcome: 'done' | 'failed',
    progress: { completed: number; total: number },
  ) => void
}

export interface DownloadProcessorResult {
  filePath: string
  fileType: string
  ops?: { download?: string; lyric?: string; tags?: string; cover?: string; error?: string }
  audioOperation?: 'downloaded' | 'redownloaded' | 'reused'
}

export type DownloadProcessor = (
  task: DownloadTask,
  onProgress: (pct: number, phase?: 'downloading' | 'tagging') => void,
  signal: AbortSignal,
) => Promise<DownloadProcessorResult>

interface TaskRow {
  id: string; source_id: string | null; song_id: number; song_name: string
  source_name?: string | null
  artist: string; album: string; status: string; progress: number
  file_path: string | null; file_type: string | null; quality: string | null
  error: string | null; retry_count: number; job_id: string | null; run_id: string | null
  auto_retry_count: number; next_attempt_at: string | null
  idempotency_key: string | null; lease_owner: string | null; lease_expires_at: string | null; attempt_started_at: string | null
  operation: string; target_path: string | null; execution_intent_json: string | null
  awaiting_source_sync?: number | null
  created_at: string; updated_at: string
}

function rowToTask(r: TaskRow): DownloadTask {
  return {
    id: r.id, sourceId: r.source_id ?? null, songId: r.song_id,
    sourceName: r.source_name ?? undefined,
    songName: r.song_name, artist: r.artist, album: r.album,
    status: r.status as DownloadTask['status'], progress: r.progress,
    filePath: r.file_path ?? undefined, fileType: r.file_type ?? undefined,
    quality: r.quality ?? undefined, error: r.error ?? undefined,
    retryCount: r.retry_count, jobId: r.run_id ?? r.job_id ?? undefined,
    autoRetryCount: r.auto_retry_count ?? 0, nextAttemptAt: r.next_attempt_at ?? undefined,
    idempotencyKey: r.idempotency_key ?? undefined,
    operation: DOWNLOAD_TASK_OPERATIONS.has(r.operation as DownloadTaskOperation)
      ? r.operation as DownloadTaskOperation
      : 'download',
    targetPath: r.target_path ?? undefined,
    executionIntent: parseExecutionIntent(r.execution_intent_json),
    awaitingSourceSync: r.awaiting_source_sync === 1,
    createdAt: r.created_at, updatedAt: r.updated_at,
  }
}

function parseExecutionIntent(value: string | null): DownloadExecutionIntent | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value) as DownloadExecutionIntent
    if (!parsed || typeof parsed !== 'object') return undefined
    return parsed
  } catch {
    return undefined
  }
}

export function getDownloadTask(id: string): DownloadTask | null {
  const db = getDb()
  createFileTaskSchema(db)
  const row = db.prepare(`
    SELECT
      dt.*,
      COALESCE(NULLIF(ps.name, ''), NULLIF(ps.netease_playlist_name, ''), NULLIF(ps.plex_playlist_name, '')) AS source_name,
      ${AWAITING_SOURCE_SYNC_PROJECTION}
    FROM download_tasks dt
    LEFT JOIN playlist_sources ps ON ps.id = dt.source_id
    WHERE dt.id = ?
  `).get(id) as TaskRow | undefined
  return row ? rowToTask(row) : null
}

export function listDownloadTasks(opts: {
  status?: string; limit?: number; offset?: number; from?: string; to?: string; search?: string; timeZone?: string; runId?: string
} = {}): { items: DownloadTask[]; total: number; earliestDate: string | null } {
  const db = getDb()
  createFileTaskSchema(db)
  const limit = opts.limit ?? 50
  const offset = opts.offset ?? 0

  const conditions: string[] = []
  const params: unknown[] = []
  if (opts.status) {
    const statuses = opts.status.split(',').map((s) => s.trim()).filter(Boolean)
    if (statuses.length === 1) {
      conditions.push('dt.status = ?')
      params.push(statuses[0])
    } else if (statuses.length > 1) {
      const placeholders = statuses.map(() => '?').join(', ')
      conditions.push(`dt.status IN (${placeholders})`)
      params.push(...statuses)
    }
  }
  if (opts.from) {
    const boundary = dateStartBoundary(opts.from, opts.timeZone)
    conditions.push('dt.updated_at >= ?')
    params.push(boundary.value)
  }
  if (opts.to) {
    const boundary = dateEndBoundary(opts.to, opts.timeZone)
    conditions.push(`dt.updated_at ${boundary.exclusive ? '<' : '<='} ?`)
    params.push(boundary.value)
  }
  if (opts.search) {
    conditions.push(`(
      LOWER(dt.song_name) LIKE ?
      OR LOWER(dt.artist) LIKE ?
      OR LOWER(dt.album) LIKE ?
      OR CAST(dt.song_id AS TEXT) LIKE ?
      OR LOWER(dt.id) LIKE ?
      OR LOWER(COALESCE(ps.name, '')) LIKE ?
      OR LOWER(COALESCE(ps.netease_playlist_name, '')) LIKE ?
    )`)
    const q = `%${opts.search.trim().toLowerCase()}%`
    const rawQ = `%${opts.search.trim()}%`
    params.push(q, q, q, rawQ, q, q, q)
  }
  if (opts.runId) {
    conditions.push(`(
      COALESCE(dt.run_id, dt.job_id) = ?
      OR EXISTS (
        SELECT 1
        FROM run_file_tasks linked_run_task
        WHERE linked_run_task.task_id = dt.id
          AND linked_run_task.run_id = ?
      )
    )`)
    params.push(opts.runId, opts.runId)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const total = (db.prepare(`SELECT COUNT(*) as cnt FROM download_tasks dt LEFT JOIN playlist_sources ps ON ps.id = dt.source_id ${where}`).get(...params) as { cnt: number }).cnt
  const rows = db.prepare(
    `SELECT
      dt.*,
      COALESCE(NULLIF(ps.name, ''), NULLIF(ps.netease_playlist_name, ''), NULLIF(ps.plex_playlist_name, '')) AS source_name,
      ${AWAITING_SOURCE_SYNC_PROJECTION}
    FROM download_tasks dt
    LEFT JOIN playlist_sources ps ON ps.id = dt.source_id
    ${where}
    ORDER BY
      CASE dt.status
        WHEN 'downloading' THEN 0
        WHEN 'tagging' THEN 0
        WHEN 'pending' THEN 1
        ELSE 2
      END ASC,
      CASE WHEN dt.status IN ('pending', 'downloading', 'tagging') THEN dt.created_at END ASC,
      dt.updated_at DESC
    LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset) as TaskRow[]

  const earliest = db.prepare(`SELECT MIN(dt.updated_at) as d FROM download_tasks dt LEFT JOIN playlist_sources ps ON ps.id = dt.source_id ${where}`).get(...params) as { d: string | null }
  return {
    items: rows.map(rowToTask),
    total,
    earliestDate: earliest.d ? dateKeyInTimeZone(earliest.d, opts.timeZone) : null,
  }
}


export function listPendingDownloadTaskIds(limit = 1000): string[] {
  const control = getDownloadQueueControl()
  if (control.paused || control.cooldownUntil) return []
  return (getDb().prepare(`
    SELECT id
    FROM download_tasks
    WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at<=?)
      AND ${ELIGIBLE_DOWNLOAD_CALLERS_SQL}
    ORDER BY created_at ASC, rowid ASC
    LIMIT ?
  `).all(new Date().toISOString(), Math.max(1, Math.trunc(limit))) as Array<{ id: string }>).map(row => row.id)
}

export function getNextDownloadWakeDelay(): number | null {
  const control = getDownloadQueueControl()
  if (control.paused) return null
  const row = getDb().prepare(`SELECT MIN(COALESCE(next_attempt_at,'')) AS next FROM download_tasks
    WHERE status='pending' AND ${ELIGIBLE_DOWNLOAD_CALLERS_SQL}`).get() as { next: string | null }
  if (row.next === null) return null
  return Math.max(0, row.next ? Date.parse(row.next) - Date.now() : 0,
    control.cooldownUntil ? Date.parse(control.cooldownUntil) - Date.now() : 0)
}

export function updateTaskState(id: string, updates: Partial<{
  status: string; progress: number; filePath: string; fileType: string
  quality: string; error: string | null; retryCount: number; leaseOwner: string | null
  leaseExpiresAt: string | null; attemptStartedAt: string | null
}>, guard?: { leaseOwner: string }): boolean {
  const sets: string[] = []
  const vals: unknown[] = []

  if (updates.status !== undefined) { sets.push('status = ?'); vals.push(updates.status) }
  if (updates.progress !== undefined) { sets.push('progress = ?'); vals.push(updates.progress) }
  if (updates.filePath !== undefined) { sets.push('file_path = ?'); vals.push(updates.filePath) }
  if (updates.fileType !== undefined) { sets.push('file_type = ?'); vals.push(updates.fileType) }
  if (updates.quality !== undefined) { sets.push('quality = ?'); vals.push(updates.quality) }
  if (updates.error !== undefined) { sets.push('error = ?'); vals.push(updates.error) }
  if (updates.retryCount !== undefined) { sets.push('retry_count = ?'); vals.push(updates.retryCount) }
  if (updates.leaseOwner !== undefined) { sets.push('lease_owner = ?'); vals.push(updates.leaseOwner) }
  if (updates.leaseExpiresAt !== undefined) { sets.push('lease_expires_at = ?'); vals.push(updates.leaseExpiresAt) }
  if (updates.attemptStartedAt !== undefined) { sets.push('attempt_started_at = ?'); vals.push(updates.attemptStartedAt) }

  sets.push('updated_at = ?')
  vals.push(new Date().toISOString())
  vals.push(id)
  let where = 'id = ?'
  if (guard) {
    where += " AND lease_owner = ? AND status IN ('downloading','tagging')"
    vals.push(guard.leaseOwner)
  }

  const result = getDb().prepare(`UPDATE download_tasks SET ${sets.join(', ')} WHERE ${where}`).run(...vals)
  if (result.changes === 0) return false

  if (updates.status === 'done' || updates.status === 'failed') {
    recordTerminalTaskState(id, updates.status, updates.error)
  }
  return true
}

function recordTerminalTaskState(id: string, status: 'done' | 'failed', error?: string | null) {
  const task = getDownloadTask(id)
  if (!task) return
  // Queue writes legacy failures; associations project every caller without changing owner.
  const associations = listFileTaskRuns(getDb(), task.id)
  const manualCallers = associations.filter((association) => {
    const associatedRun = getRun(association.runId)
    return associatedRun?.type === 'manual_download'
  })
  // A reused sync/repair owner still projects manual caller failures.
  const failureCallers = manualCallers.length > 0
    ? manualCallers
    : (!task.sourceId || getRun(task.jobId || '')?.type === 'manual_download')
      ? [{ runId: task.jobId || '', sourceId: task.sourceId }]
      : []
  const reason = error || task.error || '下载失败'
  for (const caller of failureCallers) {
    const common = {
      songId: task.songId,
      songName: task.songName,
      artist: task.artist,
      sourceId: associations.length > 0 ? caller.sourceId : caller.sourceId ?? task.sourceId,
    }
    if (status === 'done') {
      resolveFailures(common)
    } else {
      recordFailure({
        ...common,
        sourceName: task.sourceName || (common.sourceId ? '' : '手动下载'),
        runId: caller.runId || null,
        runType: 'manual_download',
        failureKind: classifyDomainErrorCode(reason, 'failed_download'),
        failureReason: reason,
        downloadTaskId: task.id,
      })
    }
  }

  const runIds = new Set(associations.map(association => association.runId))
  if (task.jobId) runIds.add(task.jobId)
  for (const runId of runIds) {
    const associatedRun = getRun(runId)
    if (associatedRun?.type === 'manual_download') syncManualDownloadRun(runId)
    if (associatedRun?.type === 'repair') syncRepairRun(runId, { finalize: false })
  }
  if (status === 'done') {
    for (const sourceId of new Set(associations.flatMap(association => association.sourceId ? [association.sourceId] : []))) {
      updateSource(sourceId, { requiresMatchReconcile: true })
    }
  }
}

export function recoverExpiredDownloadTasks(now = new Date().toISOString()): number {
  const db = getDb()
  const expired = db.prepare(`
    SELECT id
    FROM download_tasks
    WHERE status IN ('downloading','tagging')
      AND lease_expires_at IS NOT NULL
      AND lease_expires_at <= ?
  `).all(now) as Array<{ id: string }>
  if (expired.length === 0) return 0

  const error = '任务租约过期（长时间无进展），已释放下载队列槽位'
  const recover = db.prepare(`
    UPDATE download_tasks
    SET status = 'failed',
      progress = 0,
      error = ?,
      lease_owner = NULL,
      lease_expires_at = NULL,
      attempt_started_at = NULL,
      updated_at = ?
    WHERE id = ?
      AND status IN ('downloading','tagging')
      AND lease_expires_at IS NOT NULL
      AND lease_expires_at <= ?
  `)
  let recovered = 0
  for (const task of expired) {
    const result = recover.run(error, now, task.id, now)
    if (result.changes === 0) continue
    recovered++
    recordTerminalTaskState(task.id, 'failed', error)
  }
  if (recovered > 0) {
    emitEvent({
      type: 'queue-update',
      data: { status: 'stale-tasks-recovered', recovered, ...getQueueStatus() },
      timestamp: now,
    })
  }
  return recovered
}

export function enqueueTask(task: {
  sourceId?: string | null; songId: number; songName: string; artist: string
  album: string; quality?: string; jobId?: string; idempotencyKey?: string
  operation?: DownloadTaskOperation; targetPath?: string; executionIntent?: DownloadExecutionIntent
}): DownloadTask {
  const db = getDb()
  const idempotencyKey = task.idempotencyKey ?? buildDownloadTaskIdempotencyKey({
    songId: task.songId,
    quality: task.quality,
  })

  const existing = db.prepare(`
    SELECT * FROM download_tasks
    WHERE idempotency_key = ?
      AND status IN ('pending','downloading','tagging')
    ORDER BY created_at ASC
    LIMIT 1
  `).get(idempotencyKey) as TaskRow | undefined
  if (existing) return rowToTask(existing)

  const id = randomUUID()
  const now = new Date().toISOString()

  try {
    db.prepare(`
      INSERT INTO download_tasks (
        id, source_id, song_id, song_name, artist, album, status, progress,
        quality, job_id, run_id, idempotency_key, operation, target_path, execution_intent_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, task.sourceId ?? null, task.songId, task.songName, task.artist, task.album,
      task.quality ?? null, task.jobId ?? null, task.jobId ?? null, idempotencyKey,
      task.operation ?? 'download', task.targetPath ?? null,
      task.executionIntent ? JSON.stringify(task.executionIntent) : null, now, now)
  } catch {
    const raced = db.prepare(`
      SELECT * FROM download_tasks
      WHERE idempotency_key = ?
        AND status IN ('pending','downloading','tagging')
      ORDER BY created_at ASC
      LIMIT 1
    `).get(idempotencyKey) as TaskRow | undefined
    if (raced) return rowToTask(raced)
    throw new Error('下载任务入队失败')
  }

  const row = db.prepare('SELECT * FROM download_tasks WHERE id = ?').get(id) as TaskRow
  return rowToTask(row)
}

/**
 * Return failed tasks to the persistent queue without executing them here.
 * Tasks that conflict with another active task for the same output identity
 * remain failed so a retry cannot create a duplicate concurrent media write.
 */
export function requeueFailedDownloadTasks(ids: string[]): DownloadTask[] {
  const uniqueIds = [...new Set(ids.filter(Boolean))]
  if (uniqueIds.length === 0) return []
  const db = getDb()
  const now = new Date().toISOString()
  const requeuedIds = db.transaction(() => {
    const changed: string[] = []
    const statement = db.prepare(`
      UPDATE download_tasks
      SET status = 'pending',
        progress = 0,
        error = NULL,
        auto_retry_count = 0,
        next_attempt_at = NULL,
        retry_count = retry_count + 1,
        lease_owner = NULL,
        lease_expires_at = NULL,
        attempt_started_at = NULL,
        updated_at = ?
      WHERE id = ?
        AND status = 'failed'
        AND (
          idempotency_key IS NULL
          OR NOT EXISTS (
            SELECT 1
            FROM download_tasks active_task
            WHERE active_task.id != download_tasks.id
              AND active_task.idempotency_key = download_tasks.idempotency_key
              AND active_task.status IN ('pending','downloading','tagging')
          )
        )
    `)
    for (const id of uniqueIds) {
      if (statement.run(now, id).changes > 0) changed.push(id)
    }
    return changed
  })()
  const requeued = requeuedIds
    .map(id => getDownloadTask(id))
    .filter((task): task is DownloadTask => task !== null)
  const requeuedRunIds = new Set<string>()
  for (const task of requeued) {
    for (const association of listFileTaskRuns(db, task.id)) requeuedRunIds.add(association.runId)
    if (task.jobId) requeuedRunIds.add(task.jobId)
  }
  for (const runId of requeuedRunIds) {
    const run = getRun(runId)
    if (run?.type === 'manual_download') syncManualDownloadRun(runId)
    if (run?.type === 'repair') syncRepairRun(runId, { finalize: false })
  }
  return requeued
}

export function buildDownloadTaskIdempotencyKey(input: {
  songId: number
  quality?: string | null
  downloadDir?: string | null
  pathFormat?: string | null
  operation?: DownloadTaskOperation
}): string {
  return [
    'song',
    input.songId,
    input.operation || 'download',
    input.quality || '',
    input.downloadDir || '',
    input.pathFormat || '',
  ].join(':')
}

export function claimDownloadTask(id: string, leaseOwner: string, leaseDurationMs: number): DownloadTask | null {
  const now = new Date().toISOString()
  const leaseExpiresAt = new Date(Date.now() + leaseDurationMs).toISOString()
  const result = getDb().prepare(`
    UPDATE download_tasks
    SET status = 'downloading',
      progress = 0,
      next_attempt_at = NULL,
      lease_owner = ?,
      lease_expires_at = ?,
      attempt_started_at = ?,
      retry_count = retry_count + CASE WHEN status = 'failed' THEN 1 ELSE 0 END,
      updated_at = ?
    WHERE id = ?
      AND status IN ('pending','failed')
      AND (
        idempotency_key IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM download_tasks active_task
          WHERE active_task.id != download_tasks.id
            AND active_task.idempotency_key = download_tasks.idempotency_key
            AND active_task.status IN ('pending','downloading','tagging')
        )
      )
  `).run(leaseOwner, leaseExpiresAt, now, now, id)
  if (result.changes === 0) return null
  return getDownloadTask(id)
}

export { executeDownloadTasks as processAll } from './queue-execution'
export { waitForDownloadTasks } from './queue-wait'
