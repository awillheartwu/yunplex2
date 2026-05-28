import { randomUUID } from 'node:crypto'
import { getDb } from '../db'
import { emitEvent } from '../sync/events'

export interface DownloadTask {
  id: string
  sourceId: string
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
  id: string; source_id: string; song_id: number; song_name: string
  artist: string; album: string; status: string; progress: number
  file_path: string | null; file_type: string | null; quality: string | null
  error: string | null; retry_count: number; job_id: string | null
  created_at: string; updated_at: string
}

function rowToTask(r: TaskRow): DownloadTask {
  return {
    id: r.id, sourceId: r.source_id, songId: r.song_id,
    songName: r.song_name, artist: r.artist, album: r.album,
    status: r.status as DownloadTask['status'], progress: r.progress,
    filePath: r.file_path ?? undefined, fileType: r.file_type ?? undefined,
    quality: r.quality ?? undefined, error: r.error ?? undefined,
    retryCount: r.retry_count, jobId: r.job_id ?? undefined,
    createdAt: r.created_at, updatedAt: r.updated_at,
  }
}

export function getDownloadTask(id: string): DownloadTask | null {
  const row = getDb().prepare('SELECT * FROM download_tasks WHERE id = ?').get(id) as TaskRow | undefined
  return row ? rowToTask(row) : null
}

export function listDownloadTasks(opts: {
  status?: string; limit?: number; offset?: number; from?: string; to?: string; search?: string
} = {}): { items: DownloadTask[]; total: number; earliestDate: string | null } {
  const db = getDb()
  const limit = opts.limit ?? 50
  const offset = opts.offset ?? 0

  const conditions: string[] = []
  const params: unknown[] = []
  if (opts.status) {
    const statuses = opts.status.split(',').map((s) => s.trim()).filter(Boolean)
    if (statuses.length === 1) {
      conditions.push('status = ?')
      params.push(statuses[0])
    } else if (statuses.length > 1) {
      const placeholders = statuses.map(() => '?').join(', ')
      conditions.push(`status IN (${placeholders})`)
      params.push(...statuses)
    }
  }
  if (opts.from) { conditions.push('updated_at >= ?'); params.push(opts.from) }
  if (opts.to) { conditions.push('updated_at <= ?'); params.push(opts.to) }
  if (opts.search) { conditions.push('(song_name LIKE ? OR artist LIKE ? OR album LIKE ?)'); const q = `%${opts.search}%`; params.push(q, q, q) }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const total = (db.prepare(`SELECT COUNT(*) as cnt FROM download_tasks ${where}`).get(...params) as { cnt: number }).cnt
  const rows = db.prepare(
    `SELECT * FROM download_tasks ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset) as TaskRow[]

  const earliest = db.prepare('SELECT MIN(updated_at) as d FROM download_tasks WHERE status = ?').get('done') as { d: string | null }
  return { items: rows.map(rowToTask), total, earliestDate: earliest.d ? earliest.d.slice(0, 10) : null }
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
}

export function enqueueTask(task: {
  sourceId: string; songId: number; songName: string; artist: string
  album: string; quality?: string; jobId?: string
}): DownloadTask {
  const db = getDb()
  const id = randomUUID()
  const now = new Date().toISOString()

  db.prepare(`
    INSERT INTO download_tasks (id, source_id, song_id, song_name, artist, album, status, progress, quality, job_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?)
  `).run(id, task.sourceId, task.songId, task.songName, task.artist, task.album,
    task.quality ?? null, task.jobId ?? null, now, now)

  const row = db.prepare('SELECT * FROM download_tasks WHERE id = ?').get(id) as TaskRow
  return rowToTask(row)
}

export async function processAll(
  processor: (task: DownloadTask, onProgress: (pct: number) => void) => Promise<{ filePath: string; fileType: string }>,
  jobId?: string,
  concurrency = 3,
): Promise<number> {
  const db = getDb()
  const where = jobId
    ? "WHERE status IN ('pending','failed') AND job_id = ?"
    : "WHERE status IN ('pending','failed')"
  const rows = jobId
    ? (db.prepare(`SELECT * FROM download_tasks ${where} ORDER BY created_at ASC`).all(jobId) as TaskRow[])
    : (db.prepare(`SELECT * FROM download_tasks ${where} ORDER BY created_at ASC`).all() as TaskRow[])

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

        const result = await processor(task, (pct) => {
          updateTaskState(task.id, { progress: pct })
          emitEvent({
            type: 'queue-update',
            data: { taskId: task.id, songName: task.songName, status: 'downloading', progress: pct, sourceId: task.sourceId },
            timestamp: new Date().toISOString(),
          })
        })

        updateTaskState(task.id, { status: 'tagging', progress: 60 })
        emitEvent({
          type: 'queue-update',
          data: { taskId: task.id, songName: task.songName, status: 'tagging', progress: 60, sourceId: task.sourceId },
          timestamp: new Date().toISOString(),
        })

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
      } catch (err) {
        const msg = err instanceof Error ? err.message : '下载失败'
        updateTaskState(task.id, { status: 'failed', error: msg, progress: 0 })

        emitEvent({
          type: 'song-progress',
          data: { taskId: task.id, songName: task.songName, status: 'failed', error: msg, completed: ++completed, total: tasks.length, sourceId: task.sourceId },
          timestamp: new Date().toISOString(),
        })
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker())
  await Promise.all(workers)

  const failed = (db.prepare('SELECT COUNT(*) as cnt FROM download_tasks WHERE status = ?').get('failed') as { cnt: number }).cnt
  emitEvent({
    type: 'queue-update',
    data: { status: 'complete', ...getQueueStatus() },
    timestamp: new Date().toISOString(),
  })

  return failed
}

export async function retryTask(
  id: string,
  processor: (task: DownloadTask) => Promise<{ filePath: string; fileType: string }>,
): Promise<DownloadTask | null> {
  const task = getDownloadTask(id)
  if (!task || task.status !== 'failed') return null

  updateTaskState(task.id, { status: 'pending', error: undefined, progress: 0 })

  // Process just this one task
  await processAll(async (t) => processor(t), task.jobId)

  return getDownloadTask(id)
}

export async function retryAllFailed(
  processor: (task: DownloadTask) => Promise<{ filePath: string; fileType: string }>,
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

export function cleanupOldDownloadTasks(retentionDays: number): number {
  if (!retentionDays || retentionDays <= 0) return 0
  const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString()
  const result = getDb().prepare(
    "DELETE FROM download_tasks WHERE status IN ('done','failed') AND updated_at < ?",
  ).run(cutoff)
  return result.changes
}
