import { randomUUID } from 'node:crypto'
import { getDb } from '../db'
import { emitEvent } from '../sync/events'
import { recordFailure, resolveFailures } from '../tasks/failure-records'
import { syncManualDownloadRun } from '../run/store'
import { dateEndBoundary, dateKeyInTimeZone, dateStartBoundary } from '../date-range'
import { isTagWriteError } from '../tag-writer'
import { recordCompletedLocalMediaAsset } from '../sync/local-media-store'

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
  jobId?: string
  idempotencyKey?: string
  createdAt: string
  updatedAt: string
}

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
}

interface DownloadProcessorResult {
  filePath: string
  fileType: string
  ops?: { download?: string; lyric?: string; tags?: string; cover?: string; error?: string }
  audioOperation?: 'downloaded' | 'redownloaded' | 'reused'
}

type DownloadProcessor = (
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
  idempotency_key: string | null; lease_owner: string | null; lease_expires_at: string | null; attempt_started_at: string | null
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
    idempotencyKey: r.idempotency_key ?? undefined,
    createdAt: r.created_at, updatedAt: r.updated_at,
  }
}

export function getDownloadTask(id: string): DownloadTask | null {
  const row = getDb().prepare('SELECT * FROM download_tasks WHERE id = ?').get(id) as TaskRow | undefined
  return row ? rowToTask(row) : null
}

export function listDownloadTasks(opts: {
  status?: string; limit?: number; offset?: number; from?: string; to?: string; search?: string; timeZone?: string; runId?: string
} = {}): { items: DownloadTask[]; total: number; earliestDate: string | null } {
  const db = getDb()
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
    conditions.push('COALESCE(dt.run_id, dt.job_id) = ?')
    params.push(opts.runId)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const total = (db.prepare(`SELECT COUNT(*) as cnt FROM download_tasks dt LEFT JOIN playlist_sources ps ON ps.id = dt.source_id ${where}`).get(...params) as { cnt: number }).cnt
  const rows = db.prepare(
    `SELECT
      dt.*,
      COALESCE(NULLIF(ps.name, ''), NULLIF(ps.netease_playlist_name, ''), NULLIF(ps.plex_playlist_name, '')) AS source_name
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

export function getQueueStatus(): QueueStatus {
  const db = getDb()
  const rows = db.prepare(
    'SELECT status, COUNT(*) as cnt FROM download_tasks GROUP BY status',
  ).all() as { status: string; cnt: number }[]

  const map: Record<string, number> = {}
  for (const r of rows) map[r.status] = r.cnt

  return {
    pending: map.pending ?? 0,
    downloading: map.downloading ?? 0,
    tagging: map.tagging ?? 0,
    done: map.done ?? 0,
    failed: map.failed ?? 0,
    total: Object.values(map).reduce((a, b) => a + b, 0),
  }
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
  const common = {
    songId: task.songId,
    songName: task.songName,
    artist: task.artist,
    sourceId: task.sourceId,
  }
  if (status === 'done') {
    resolveFailures(common)
  } else {
    const reason = error || task.error || '下载失败'
    recordFailure({
      ...common,
      sourceName: task.sourceId || '手动下载',
      runId: task.jobId || null,
      runType: task.sourceId ? 'sync' : 'manual_download',
      failureKind: /metadata|tag|标签/i.test(reason) ? 'failed_tags' : /copyright|版权/i.test(reason) ? 'copyright_restricted' : 'failed_download',
      failureReason: reason,
      downloadTaskId: task.id,
    })
  }
  if (task.jobId) syncManualDownloadRun(task.jobId)
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
      INSERT INTO download_tasks (id, source_id, song_id, song_name, artist, album, status, progress, quality, job_id, run_id, idempotency_key, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?, ?, ?)
    `).run(id, task.sourceId ?? null, task.songId, task.songName, task.artist, task.album,
      task.quality ?? null, task.jobId ?? null, task.jobId ?? null, idempotencyKey, now, now)
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

export function buildDownloadTaskIdempotencyKey(input: {
  songId: number
  quality?: string | null
  downloadDir?: string | null
  pathFormat?: string | null
  operation?: 'download' | 'replace'
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

function claimTask(id: string, leaseOwner: string, leaseDurationMs: number): DownloadTask | null {
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

export async function processAll(
  processor: DownloadProcessor,
  jobId?: string,
  concurrency = 3,
  taskIds?: string[],
  options: ProcessDownloadQueueOptions = {},
): Promise<number> {
  const db = getDb()
  recoverExpiredDownloadTasks()
  const conditions = taskIds?.length
    ? ["status IN ('pending','failed','downloading','tagging')"]
    : ["status IN ('pending','failed')"]
  const queryParams: unknown[] = []
  if (jobId) {
    conditions.push('COALESCE(run_id, job_id) = ?')
    queryParams.push(jobId)
  }
  if (taskIds?.length) {
    conditions.push(`id IN (${taskIds.map(() => '?').join(',')})`)
    queryParams.push(...taskIds)
  }
  const where = `WHERE ${conditions.join(' AND ')}`
  const rows = db.prepare(`SELECT * FROM download_tasks ${where} ORDER BY created_at ASC`).all(...queryParams) as TaskRow[]

  const tasks = rows.map(rowToTask)
  if (tasks.length === 0) return 0

  const leaseOwner = randomUUID()
  const inactivityTimeoutMs = options.inactivityTimeoutMs ?? DOWNLOAD_TASK_INACTIVITY_TIMEOUT_MS
  const leaseDurationMs = options.leaseDurationMs ?? DOWNLOAD_TASK_LEASE_MS
  let completed = 0
  let idx = 0

  async function worker() {
    while (idx < tasks.length) {
      const selected = tasks[idx++]
      if (!selected) continue
      const task = claimTask(selected.id, leaseOwner, leaseDurationMs)
      if (!task) continue
      try {
        emitEvent({
          type: 'queue-update',
          data: { taskId: task.id, songName: task.songName, status: 'downloading', progress: 0, sourceId: task.sourceId },
          timestamp: new Date().toISOString(),
        })

        const abortController = new AbortController()
        let watchdog: ReturnType<typeof setTimeout> | undefined
        let watchdogActive = true
        const resetWatchdog = (reject: (reason: Error) => void) => {
          if (!watchdogActive) return
          if (watchdog) clearTimeout(watchdog)
          watchdog = setTimeout(() => {
            if (!watchdogActive) return
            watchdogActive = false
            abortController.abort()
            reject(new Error(`任务无进展超时（>${Math.ceil(inactivityTimeoutMs / 1000)} 秒），已释放下载队列槽位`))
          }, inactivityTimeoutMs)
          watchdog.unref?.()
        }
        const result = await new Promise<DownloadProcessorResult>((resolve, reject) => {
          resetWatchdog(reject)
          void processor(task, (pct, phase) => {
            resetWatchdog(reject)
            const status = phase || 'downloading'
            const updated = updateTaskState(task.id, {
              progress: pct,
              status,
              leaseExpiresAt: new Date(Date.now() + leaseDurationMs).toISOString(),
            }, { leaseOwner })
            if (!updated) return
            emitEvent({
              type: 'queue-update',
              data: { taskId: task.id, songName: task.songName, status, progress: pct, sourceId: task.sourceId },
              timestamp: new Date().toISOString(),
            })
          }, abortController.signal).then(
            value => {
              if (!watchdogActive) return
              watchdogActive = false
              resolve(value)
            },
            error => {
              if (!watchdogActive) return
              watchdogActive = false
              reject(error)
            },
          )
        }).finally(() => {
          watchdogActive = false
          if (watchdog) clearTimeout(watchdog)
        })

        // Tag-writing failures must not silently pass as "done"
        if (result.ops?.tags === 'failed') {
          const detail = result.ops.error || '未知标签错误'
          const msg = `标签写入失败: ${task.songName} — ${detail}`
          const updated = updateTaskState(task.id, {
            status: 'failed',
            error: msg,
            progress: 0,
            filePath: result.filePath,
            fileType: result.fileType,
            leaseOwner: null,
            leaseExpiresAt: null,
          }, { leaseOwner })
          if (!updated) continue

          emitEvent({
            type: 'song-progress',
            data: {
              taskId: task.id,
              songName: task.songName,
              status: 'failed',
              error: msg,
              completed: ++completed,
              total: tasks.length,
              sourceId: task.sourceId ?? undefined,
              filePath: result.filePath,
              fileType: result.fileType,
            },
            timestamp: new Date().toISOString(),
          })
          continue
        }

        const updated = updateTaskState(task.id, {
          status: 'done', progress: 100,
          filePath: result.filePath, fileType: result.fileType,
          error: null,
          leaseOwner: null,
          leaseExpiresAt: null,
        }, { leaseOwner })
        if (!updated) continue
        recordCompletedLocalMediaAsset({
          neteaseSongId: task.songId,
          filePath: result.filePath,
          sourceTaskId: task.id,
          audioDownloaded: result.ops?.download === 'ok',
          audioOperation: result.audioOperation,
          runId: task.jobId ?? null,
          sourceId: task.sourceId,
        })

        emitEvent({
          type: 'song-progress',
          data: { taskId: task.id, songName: task.songName, status: 'done', completed: ++completed, total: tasks.length, sourceId: task.sourceId },
          timestamp: new Date().toISOString(),
        })
      } catch (err) {
        const tagError = isTagWriteError(err) ? err : null
        const msg = tagError ? tagError.message : err instanceof Error ? err.message : '下载失败'
        const updated = updateTaskState(task.id, {
          status: 'failed',
          error: msg,
          progress: 0,
          ...(tagError?.filePath ? { filePath: tagError.filePath } : {}),
          ...(tagError?.fileType ? { fileType: tagError.fileType } : {}),
          leaseOwner: null,
          leaseExpiresAt: null,
        }, { leaseOwner })
        if (!updated) continue

        emitEvent({
          type: 'song-progress',
          data: {
            taskId: task.id,
            songName: task.songName,
            status: 'failed',
            error: msg,
            completed: ++completed,
            total: tasks.length,
            sourceId: task.sourceId,
            ...(tagError?.filePath ? { filePath: tagError.filePath } : {}),
            ...(tagError?.fileType ? { fileType: tagError.fileType } : {}),
          },
          timestamp: new Date().toISOString(),
        })
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker())
  await Promise.all(workers)
  if (taskIds?.length) await waitForTasksToSettle(taskIds)

  // Count only tasks matching the same filter as the workers (batch-specific if jobId provided)
  const countConditions = ["status = 'failed'"]
  const countParams: unknown[] = []
  if (jobId) {
    countConditions.push('COALESCE(run_id, job_id) = ?')
    countParams.push(jobId)
  }
  if (taskIds?.length) {
    countConditions.push(`id IN (${taskIds.map(() => '?').join(',')})`)
    countParams.push(...taskIds)
  }
  const failed = (db.prepare(
    `SELECT COUNT(*) as cnt FROM download_tasks WHERE ${countConditions.join(' AND ')}`,
  ).get(...countParams) as { cnt: number }).cnt
  emitEvent({
    type: 'queue-update',
    data: { status: 'complete', ...getQueueStatus() },
    timestamp: new Date().toISOString(),
  })

  return failed
}

async function waitForTasksToSettle(taskIds: string[], timeoutMs = 30 * 60 * 1000): Promise<void> {
  if (taskIds.length === 0) return
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const row = getDb().prepare(`
      SELECT COUNT(*) AS count
      FROM download_tasks
      WHERE id IN (${taskIds.map(() => '?').join(',')})
        AND status IN ('pending','downloading','tagging')
    `).get(...taskIds) as { count: number }
    if (row.count === 0) return
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
}

export async function retryTask(
  id: string,
  processor: (task: DownloadTask, onProgress: (pct: number, phase?: 'downloading' | 'tagging') => void) => Promise<{ filePath: string; fileType: string }>,
): Promise<DownloadTask | null> {
  const task = getDownloadTask(id)
  if (!task || task.status !== 'failed') return null

  await processAll(async (t, onProgress) => processor(t, onProgress), undefined, 1, [task.id])

  return getDownloadTask(id)
}

export async function retryAllFailed(
  processor: (task: DownloadTask, onProgress: (pct: number, phase?: 'downloading' | 'tagging') => void) => Promise<{ filePath: string; fileType: string }>,
): Promise<number> {
  const db = getDb()
  const rows = db.prepare("SELECT id FROM download_tasks WHERE status = 'failed'").all() as Array<{ id: string }>
  await processAll(processor, undefined, 3, rows.map(row => row.id))
  return rows.length
}

export function clearDownloadTasks(): void {
  getDb().prepare('DELETE FROM download_tasks').run()
}

export function clearQueuedDownloadTasks(): number {
  const result = getDb().prepare(
    "DELETE FROM download_tasks WHERE status IN ('pending', 'failed')",
  ).run()
  return result.changes
}

export function deleteDownloadTask(id: string): boolean {
  const result = getDb().prepare(
    "DELETE FROM download_tasks WHERE id = ? AND status NOT IN ('downloading', 'tagging')",
  ).run(id)
  return result.changes > 0
}

export function cleanupOldDownloadTasks(retentionDays: number): number {
  if (!retentionDays || retentionDays <= 0) return 0
  const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString()
  const result = getDb().prepare(
    "DELETE FROM download_tasks WHERE status IN ('done','failed') AND updated_at < ?",
  ).run(cutoff)
  return result.changes
}
