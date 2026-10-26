import { getQueueStatus } from './queue-status'
export { getQueueStatus } from './queue-status'
import { AWAITING_SOURCE_SYNC_PROJECTION } from './task-status-projection'
import { randomUUID } from 'node:crypto'
import { getDb } from '../db'
import { createFileTaskSchema, listFileTaskRuns, linkRunFileTask } from '../db/file-task-schema'
import { emitEvent } from '../sync/events'
import { recordFailure } from '../tasks/failure-records'
import { completeFileTask, confirmManualBindingSupersedesFileIntents } from '../tasks/completion'
import { getRun, createManualDownloadRun, createRepairRun, syncManualDownloadRun, syncRepairRun } from '../run/store'
import type { TaskRunTrigger } from '../job/types'
import type { LyricOrder } from '../config/types'
import { updateSource } from '../playlist/store'
import { dateEndBoundary, dateKeyInTimeZone, dateStartBoundary } from '../date-range'
import { classifyDomainErrorCode, isDomainErrorCode, type DomainErrorCode } from '../../../shared/domain-errors'
import { READY_DOWNLOAD_TASK_SQL, getDownloadQueueControl } from './queue-control'
import type { DownloadAudioCache } from './audio-cache'

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
  errorCode?: DomainErrorCode
  errorPhase?: 'download' | 'tags'
  nextRetryAt?: string
  retryCount: number
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
  artistAliases?: Record<string, string>
  applyAliasToAlbum?: boolean
  manualBindingVersion?: string | null
  downloadDir?: string
  pathFormat?: string
  multiArtistFormat?: string
  lyricOrder?: LyricOrder
  downloadTranslatedLyric?: boolean
  downloadRomajiLyric?: boolean
  downloadMode?: 'full' | 'missing' | 'replace'
  target?:
    | { kind: 'computed'; protectedPath?: string; requireManagedCopy?: boolean }
    | { kind: 'existing'; path: string }
  downloadLyrics?: boolean
  embedMetadata?: boolean
  embedCover?: boolean
  saveAlbumCover?: boolean
  saveArtistImage?: boolean
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
  audioCache?: DownloadAudioCache
}

export type DownloadProcessor = (
  task: DownloadTask,
  onProgress: (pct: number, phase?: 'downloading' | 'tagging') => void,
  signal: AbortSignal,
  commit: DownloadCommit,
) => Promise<DownloadProcessorResult>

export type DownloadCommit = (result: DownloadProcessorResult, publish: () => void) => Promise<void>

interface TaskRow {
  id: string; source_id: string | null; song_id: number; song_name: string
  source_name?: string | null
  artist: string; album: string; status: string; progress: number
  file_path: string | null; file_type: string | null; quality: string | null
  error: string | null; error_code: string | null; retry_count: number; job_id: string | null; run_id: string | null
  idempotency_key: string | null; lease_owner: string | null; lease_expires_at: string | null; attempt_started_at: string | null
  operation: string; target_path: string | null; execution_intent_json: string | null
  awaiting_source_sync?: number | null
  created_at: string; updated_at: string
  next_retry_at?: string | null
  error_phase?: string | null
}

function rowToTask(r: TaskRow): DownloadTask {
  return {
    id: r.id, sourceId: r.source_id ?? null, songId: r.song_id,
    sourceName: r.source_name ?? undefined,
    songName: r.song_name, artist: r.artist, album: r.album,
    status: r.status as DownloadTask['status'], progress: r.progress,
    filePath: r.file_path ?? undefined, fileType: r.file_type ?? undefined,
    quality: r.quality ?? undefined, error: r.error ?? undefined,
    errorCode: isDomainErrorCode(r.error_code) ? r.error_code : undefined,
    errorPhase: r.error_phase === 'download' || r.error_phase === 'tags' ? r.error_phase : undefined,
    nextRetryAt: r.next_retry_at ?? undefined,
    retryCount: r.retry_count, jobId: r.run_id ?? r.job_id ?? undefined,
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
    WHERE status = 'pending'
      AND ${READY_DOWNLOAD_TASK_SQL}
    ORDER BY created_at ASC, rowid ASC
    LIMIT ?
  `).all(Math.max(1, Math.trunc(limit))) as Array<{ id: string }>).map(row => row.id)
}

export function getNextDownloadWakeDelay(): number | null {
  const control = getDownloadQueueControl()
  if (control.paused) return null
  const row = getDb().prepare(`SELECT 1 FROM download_tasks
    WHERE status='pending' AND ${READY_DOWNLOAD_TASK_SQL} LIMIT 1`).get()
  if (!row) return null
  return Math.max(0, control.cooldownUntil ? Date.parse(control.cooldownUntil) - Date.now() : 0)
}

export function updateTaskState(id: string, updates: Partial<{
  status: string; progress: number; filePath: string; fileType: string
  quality: string; error: string | null; errorCode: DomainErrorCode | null; errorPhase: 'download' | 'tags' | null; retryCount: number; leaseOwner: string | null
  leaseExpiresAt: string | null; attemptStartedAt: string | null
}>, guard?: { leaseOwner: string }): boolean {
  createFileTaskSchema(getDb())
  const sets: string[] = []
  const vals: unknown[] = []

  if (updates.status !== undefined) { sets.push('status = ?'); vals.push(updates.status) }
  if (updates.status === 'done') sets.push('next_retry_at = NULL', 'error_phase = NULL')
  if (updates.progress !== undefined) { sets.push('progress = ?'); vals.push(updates.progress) }
  if (updates.filePath !== undefined) { sets.push('file_path = ?'); vals.push(updates.filePath) }
  if (updates.fileType !== undefined) { sets.push('file_type = ?'); vals.push(updates.fileType) }
  if (updates.quality !== undefined) { sets.push('quality = ?'); vals.push(updates.quality) }
  if (updates.error !== undefined) { sets.push('error = ?'); vals.push(updates.error) }
  if (updates.errorCode !== undefined) { sets.push('error_code = ?'); vals.push(updates.errorCode) }
  if (updates.errorPhase !== undefined) { sets.push('error_phase = ?'); vals.push(updates.errorPhase) }
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
  // Every caller sees the same attempt immediately; final run projection deduplicates it.
  const associations = listFileTaskRuns(getDb(), task.id)
  const activeCallers = associations.filter(caller => getRun(caller.runId)?.status === 'running')
  const failureCallers = activeCallers.length > 0 ? activeCallers
    : associations.length > 0 ? associations.slice(-1) : [{ runId: task.jobId || '', sourceId: task.sourceId }]
  if (status === 'done') completeFileTask(task.id)
  let nextRetryAt: string | null = null
  const reason = error || task.error || '下载失败'
  for (const caller of failureCallers) {
    const run = getRun(caller.runId)
    const runType = run?.type ?? 'manual_download'
    const common = {
      songId: task.songId,
      songName: task.songName,
      artist: task.artist,
      sourceId: associations.length > 0 ? caller.sourceId : caller.sourceId ?? task.sourceId,
    }
    if (status === 'failed') {
      const problem = recordFailure({
        ...common,
        sourceName: task.sourceName || (common.sourceId ? '' : '手动下载'),
        runId: caller.runId || null,
        runType,
        failureKind: task.errorCode ?? classifyDomainErrorCode(reason, 'failed_download'),
        failureReason: reason,
        downloadTaskId: task.id,
      })
      const cooldownUntil = getDownloadQueueControl().cooldownUntil
      const recoveryAt = problem.recovery?.nextRetryAt
      const plannedAt = runType === 'sync' || !recoveryAt ? null
        : cooldownUntil && cooldownUntil > recoveryAt ? cooldownUntil : recoveryAt
      if (plannedAt && (!nextRetryAt || plannedAt < nextRetryAt)) nextRetryAt = plannedAt
    }
  }

  if (status === 'failed') {
    getDb().prepare('UPDATE download_tasks SET next_retry_at=? WHERE id=?').run(nextRetryAt, task.id)
    confirmManualBindingSupersedesFileIntents(task.songId)
  }

  const runIds = new Set(associations.map(association => association.runId))
  if (task.jobId) runIds.add(task.jobId)
  for (const runId of runIds) {
    const associatedRun = getRun(runId)
    if (associatedRun?.type === 'manual_download' && associatedRun.status === 'running') syncManualDownloadRun(runId)
    if (associatedRun?.type === 'repair' && associatedRun.status === 'running') syncRepairRun(runId, { finalize: false })
  }
  if (status === 'done') {
    for (const sourceId of new Set(associations.flatMap(association => association.sourceId ? [association.sourceId] : []))) {
      updateSource(sourceId, { requiresMatchReconcile: true })
    }
  }
}

export function recoverExpiredDownloadTasks(now = new Date().toISOString()): number {
  return recoverActiveDownloadTasks(now, false)
}

export function recoverInterruptedDownloadTasks(now = new Date().toISOString()): number {
  return recoverActiveDownloadTasks(now, true)
}

function recoverActiveDownloadTasks(now: string, interrupted: boolean): number {
  const db = getDb()
  createFileTaskSchema(db)
  const leaseFilter = interrupted ? '' : 'AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?'
  const leaseParams = interrupted ? [] : [now]
  const expired = db.prepare(`
    SELECT id
    FROM download_tasks
    WHERE status IN ('downloading','tagging')
      ${leaseFilter}
  `).all(...leaseParams) as Array<{ id: string }>
  if (expired.length === 0) return 0

  const error = interrupted ? '任务因服务重启中断' : '任务租约过期（长时间无进展），已释放下载队列槽位'
  const recover = db.prepare(`
    UPDATE download_tasks
    SET status = 'failed',
      progress = 0,
      error = ?,
      error_code = 'scheduler_interrupted',
      error_phase = CASE WHEN status = 'tagging' THEN 'tags' ELSE 'download' END,
      lease_owner = NULL,
      lease_expires_at = NULL,
      attempt_started_at = NULL,
      updated_at = ?
    WHERE id = ?
      AND status IN ('downloading','tagging')
      ${leaseFilter}
  `)
  let recovered = 0
  for (const task of expired) {
    const result = recover.run(error, now, task.id, ...leaseParams)
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
export function requeueFailedDownloadTasks(ids: string[], options: { resumeRuns?: boolean; sourceByTask?: ReadonlyMap<string, string | null>; trigger?: TaskRunTrigger } = {}): DownloadTask[] {
  const uniqueIds = [...new Set(ids.filter(Boolean))]
  if (uniqueIds.length === 0) return []
  const db = getDb()
  createFileTaskSchema(db)
  const now = new Date().toISOString()
  return db.transaction(() => {
    const changed: string[] = []
    const statement = db.prepare(`
      UPDATE download_tasks
      SET status = 'pending',
        progress = 0,
        error = NULL,
        error_code = NULL,
        error_phase = NULL,
        retry_count = retry_count + 1,
        lease_owner = NULL,
        lease_expires_at = NULL,
        attempt_started_at = NULL,
        next_retry_at = NULL,
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
    const requeued = changed.map(id => getDownloadTask(id)!)
    if (options.resumeRuns !== false && requeued.length) {
      const sourceOf = (task: DownloadTask) => options.sourceByTask?.has(task.id) ? options.sourceByTask.get(task.id)! : task.sourceId
      const groups = new Map<string, DownloadTask[]>()
      for (const task of requeued) {
        const key = task.operation === 'repair_existing' ? `repair:${sourceOf(task) ?? ''}` : 'download'
        groups.set(key, [...(groups.get(key) ?? []), task])
      }
      for (const tasks of groups.values()) {
        const runId = randomUUID()
        const trigger = options.trigger ?? 'retry'
        const repair = tasks[0]!.operation === 'repair_existing'
        if (repair) createRepairRun({ id: runId, total: tasks.length, skipped: 0, trigger,
          sourceId: sourceOf(tasks[0]!), sourceLabel: tasks[0]!.sourceName || '重试补全文件' })
        else createManualDownloadRun({ id: runId, total: tasks.length, sourceLabel: '重试文件任务', trigger,
          sourceIds: [...new Set(tasks.flatMap(task => sourceOf(task) ? [sourceOf(task)!] : []))] })
        for (const task of tasks) linkRunFileTask(db, { runId, taskId: task.id, sourceId: sourceOf(task) })
        if (repair) syncRepairRun(runId, { finalize: false })
        else syncManualDownloadRun(runId)
      }
    }
    return requeued
  })()
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
      lease_owner = ?,
      lease_expires_at = ?,
      attempt_started_at = ?,
      retry_count = retry_count + CASE WHEN status = 'failed' THEN 1 ELSE 0 END,
      updated_at = ?
    WHERE id = ?
      AND status IN ('pending','failed')
      AND ${READY_DOWNLOAD_TASK_SQL}
      AND (idempotency_key IS NULL OR NOT EXISTS (
        SELECT 1 FROM download_tasks same_request
        WHERE same_request.id!=download_tasks.id AND same_request.idempotency_key=download_tasks.idempotency_key
          AND same_request.status IN ('pending','downloading','tagging')
      ))
  `).run(leaseOwner, leaseExpiresAt, now, now, id)
  if (result.changes === 0) return null
  return getDownloadTask(id)
}

export { executeDownloadTasks as processAll } from './queue-execution'
export { waitForDownloadTasks } from './queue-wait'
