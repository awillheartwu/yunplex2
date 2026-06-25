import { randomUUID } from 'node:crypto'
import { getDb } from '../db'
import { emitEvent } from '../sync/events'
import { recordActivityEvent } from '../activity/store'
import { recordFailure, resolveFailures } from '../tasks/failure-records'
import { syncManualDownloadRun } from '../run/store'
import { dateEndBoundary, dateKeyInTimeZone, dateStartBoundary } from '../date-range'

export interface DownloadTask {
  id: string
  sourceId: string | null
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

interface TaskRow {
  id: string; source_id: string | null; song_id: number; song_name: string
  artist: string; album: string; status: string; progress: number
  file_path: string | null; file_type: string | null; quality: string | null
  error: string | null; retry_count: number; job_id: string | null; run_id: string | null
  created_at: string; updated_at: string
}

function rowToTask(r: TaskRow): DownloadTask {
  return {
    id: r.id, sourceId: r.source_id ?? null, songId: r.song_id,
    songName: r.song_name, artist: r.artist, album: r.album,
    status: r.status as DownloadTask['status'], progress: r.progress,
    filePath: r.file_path ?? undefined, fileType: r.file_type ?? undefined,
    quality: r.quality ?? undefined, error: r.error ?? undefined,
    retryCount: r.retry_count, jobId: r.run_id ?? r.job_id ?? undefined,
    createdAt: r.created_at, updatedAt: r.updated_at,
  }
}

export function getDownloadTask(id: string): DownloadTask | null {
  const row = getDb().prepare('SELECT * FROM download_tasks WHERE id = ?').get(id) as TaskRow | undefined
  return row ? rowToTask(row) : null
}

export function listDownloadTasks(opts: {
  status?: string; limit?: number; offset?: number; from?: string; to?: string; search?: string; timeZone?: string
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

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const total = (db.prepare(`SELECT COUNT(*) as cnt FROM download_tasks dt LEFT JOIN playlist_sources ps ON ps.id = dt.source_id ${where}`).get(...params) as { cnt: number }).cnt
  const rows = db.prepare(
    `SELECT dt.* FROM download_tasks dt LEFT JOIN playlist_sources ps ON ps.id = dt.source_id ${where} ORDER BY dt.updated_at DESC LIMIT ? OFFSET ?`,
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
  quality: string; error: string; retryCount: number
}>) {
  const sets: string[] = []
  const vals: unknown[] = []

  if (updates.status !== undefined) { sets.push('status = ?'); vals.push(updates.status) }
  if (updates.progress !== undefined) { sets.push('progress = ?'); vals.push(updates.progress) }
  if (updates.filePath !== undefined) { sets.push('file_path = ?'); vals.push(updates.filePath) }
  if (updates.fileType !== undefined) { sets.push('file_type = ?'); vals.push(updates.fileType) }
  if (updates.quality !== undefined) { sets.push('quality = ?'); vals.push(updates.quality) }
  if (updates.error !== undefined) { sets.push('error = ?'); vals.push(updates.error) }
  if (updates.retryCount !== undefined) { sets.push('retry_count = ?'); vals.push(updates.retryCount) }

  sets.push('updated_at = ?')
  vals.push(new Date().toISOString())
  vals.push(id)

  getDb().prepare(`UPDATE download_tasks SET ${sets.join(', ')} WHERE id = ?`).run(...vals)

  if (updates.status === 'done' || updates.status === 'failed') {
    const task = getDownloadTask(id)
    if (task) {
      const common = {
        songId: task.songId,
        songName: task.songName,
        artist: task.artist,
        sourceId: task.sourceId,
      }
      if (updates.status === 'done') {
        resolveFailures(common)
      } else {
        const reason = updates.error || task.error || '下载失败'
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
  }
}

export function enqueueTask(task: {
  sourceId?: string | null; songId: number; songName: string; artist: string
  album: string; quality?: string; jobId?: string
}): DownloadTask {
  const db = getDb()
  const id = randomUUID()
  const now = new Date().toISOString()

  db.prepare(`
    INSERT INTO download_tasks (id, source_id, song_id, song_name, artist, album, status, progress, quality, job_id, run_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?, ?)
  `).run(id, task.sourceId ?? null, task.songId, task.songName, task.artist, task.album,
    task.quality ?? null, task.jobId ?? null, task.jobId ?? null, now, now)

  const row = db.prepare('SELECT * FROM download_tasks WHERE id = ?').get(id) as TaskRow
  return rowToTask(row)
}

export async function processAll(
  processor: (task: DownloadTask, onProgress: (pct: number, phase?: 'downloading' | 'tagging') => void) => Promise<{ filePath: string; fileType: string; ops?: { download?: string; lyric?: string; tags?: string; cover?: string; error?: string } }>,
  jobId?: string,
  concurrency = 3,
  taskIds?: string[],
): Promise<number> {
  const db = getDb()
  const conditions = ["status IN ('pending','failed')"]
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

  let completed = 0
  let idx = 0

  async function worker() {
    while (idx < tasks.length) {
      const task = tasks[idx++]
      if (!task) continue
      try {
        updateTaskState(task.id, { status: 'downloading', progress: 0 })
        emitEvent({
          type: 'queue-update',
          data: { taskId: task.id, songName: task.songName, status: 'downloading', progress: 0, sourceId: task.sourceId },
          timestamp: new Date().toISOString(),
        })

        const result = await processor(task, (pct, phase) => {
          const status = phase || 'downloading'
          updateTaskState(task.id, { progress: pct, status })
          emitEvent({
            type: 'queue-update',
            data: { taskId: task.id, songName: task.songName, status, progress: pct, sourceId: task.sourceId },
            timestamp: new Date().toISOString(),
          })
        })

        // Tag-writing failures must not silently pass as "done"
        if (result.ops?.tags === 'failed') {
          const detail = result.ops.error || '未知标签错误'
          const msg = `标签写入失败: ${task.songName} — ${detail}`
          updateTaskState(task.id, {
            status: 'failed',
            error: msg,
            progress: 0,
            filePath: result.filePath,
            fileType: result.fileType,
          })

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
          recordActivityEvent({
            domain: 'download',
            type: 'download_failed',
            severity: 'error',
            title: `标签写入失败：${task.songName}`,
            summary: msg,
            context: {
              sourceId: task.sourceId,
              taskId: task.id,
              songId: task.songId,
              songName: task.songName,
              jobId: task.jobId,
              filePath: result.filePath,
            },
            link: '/task-center?tab=failures',
            groupKey: `download:${task.jobId || 'manual'}:${task.sourceId || 'manual'}`,
          })
          continue
        }

        updateTaskState(task.id, {
          status: 'done', progress: 100,
          filePath: result.filePath, fileType: result.fileType,
          error: undefined,
        })

        emitEvent({
          type: 'song-progress',
          data: { taskId: task.id, songName: task.songName, status: 'done', completed: ++completed, total: tasks.length, sourceId: task.sourceId },
          timestamp: new Date().toISOString(),
        })
        recordActivityEvent({
          domain: 'download',
          type: 'download_completed',
          severity: 'success',
          title: `下载完成：${task.songName}`,
          summary: `${task.artist || '未知艺人'} · ${task.album || '未知专辑'} 已处理完成`,
            context: { sourceId: task.sourceId ?? undefined, taskId: task.id, songId: task.songId, songName: task.songName, jobId: task.jobId },
          link: task.jobId ? `/task-center/runs/${task.jobId}` : '/manual-download?view=history',
          groupKey: `download:${task.jobId || 'manual'}:${task.sourceId || 'manual'}`,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : '下载失败'
        updateTaskState(task.id, { status: 'failed', error: msg, progress: 0 })

        emitEvent({
          type: 'song-progress',
          data: { taskId: task.id, songName: task.songName, status: 'failed', error: msg, completed: ++completed, total: tasks.length, sourceId: task.sourceId },
          timestamp: new Date().toISOString(),
        })
        recordActivityEvent({
          domain: 'download',
          type: 'download_failed',
          severity: 'error',
          title: `下载失败：${task.songName}`,
          summary: msg,
          context: { sourceId: task.sourceId ?? undefined, taskId: task.id, songId: task.songId, songName: task.songName, jobId: task.jobId },
          link: '/task-center?tab=failures',
          groupKey: `download:${task.jobId || 'manual'}:${task.sourceId || 'manual'}`,
        })
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker())
  await Promise.all(workers)

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

export async function retryTask(
  id: string,
  processor: (task: DownloadTask, onProgress: (pct: number, phase?: 'downloading' | 'tagging') => void) => Promise<{ filePath: string; fileType: string }>,
): Promise<DownloadTask | null> {
  const task = getDownloadTask(id)
  if (!task || task.status !== 'failed') return null

  updateTaskState(task.id, { status: 'pending', error: undefined, progress: 0 })

  // Process just this one task
  await processAll(async (t, onProgress) => processor(t, onProgress), task.jobId)

  return getDownloadTask(id)
}

export async function retryAllFailed(
  processor: (task: DownloadTask, onProgress: (pct: number, phase?: 'downloading' | 'tagging') => void) => Promise<{ filePath: string; fileType: string }>,
): Promise<number> {
  const db = getDb()
  db.prepare("UPDATE download_tasks SET status = 'pending', error = NULL, progress = 0 WHERE status = 'failed'").run()

  const count = (db.prepare("SELECT COUNT(*) as cnt FROM download_tasks WHERE status = 'pending'").get() as { cnt: number }).cnt
  await processAll(processor)
  return count
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
