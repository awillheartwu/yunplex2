import { getDb } from '../db'
import { createFileTaskSchema } from '../db/file-task-schema'
import { emitEvent } from '../sync/events'

export class DownloadCancelledError extends Error {
  constructor() { super('用户取消下载'); this.name = 'DownloadCancelledError' }
}

const activeDownloads = new Map<string, () => void>()

export function registerActiveDownload(taskId: string, cancel: () => void): () => void {
  activeDownloads.set(taskId, cancel)
  return () => { activeDownloads.delete(taskId) }
}

export interface DownloadQueueControl {
  paused: boolean
  reason: 'manual' | 'authentication' | 'filesystem' | null
  message: string | null
  cooldownUntil: string | null
}

export function getDownloadQueueControl(): DownloadQueueControl {
  const db = getDb()
  createFileTaskSchema(db)
  const row = db.prepare('SELECT pause_reason, message, cooldown_until FROM download_queue_control WHERE id = 1').get() as {
    pause_reason: DownloadQueueControl['reason']; message: string | null; cooldown_until: string | null
  } | undefined
  return {
    paused: Boolean(row?.pause_reason), reason: row?.pause_reason ?? null,
    message: row?.message ?? null,
    cooldownUntil: row?.cooldown_until && Date.parse(row.cooldown_until) > Date.now() ? row.cooldown_until : null,
  }
}

export function pauseDownloadQueue(reason: NonNullable<DownloadQueueControl['reason']>, message: string): void {
  if (reason !== 'manual' && getDownloadQueueControl().reason === 'manual') return
  const db = getDb()
  createFileTaskSchema(db)
  db.prepare(`INSERT INTO download_queue_control (id, pause_reason, message) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET pause_reason=excluded.pause_reason, message=excluded.message`).run(reason, message)
  notify()
}

export function resumeDownloadQueue(): void {
  getDb().prepare('UPDATE download_queue_control SET pause_reason=NULL, message=NULL WHERE id=1').run()
  notify()
}

export function coolDownDownloadQueue(delayMs: number): void {
  const db = getDb()
  createFileTaskSchema(db)
  const until = new Date(Date.now() + Math.min(delayMs, 24 * 60 * 60 * 1000)).toISOString()
  db.prepare(`INSERT INTO download_queue_control (id, cooldown_until) VALUES (1, ?)
    ON CONFLICT(id) DO UPDATE SET cooldown_until=MAX(COALESCE(cooldown_until,''), excluded.cooldown_until)`).run(until)
  notify()
}

/** A paused caller cannot stop a file another caller still needs. */
export const ELIGIBLE_DOWNLOAD_CALLERS_SQL = `((NOT EXISTS (
  SELECT 1 FROM run_file_tasks caller WHERE caller.task_id=download_tasks.id
) AND (COALESCE(download_tasks.run_id,download_tasks.job_id) IS NULL OR EXISTS (
  SELECT 1 FROM task_runs owner WHERE owner.id=COALESCE(download_tasks.run_id,download_tasks.job_id) AND owner.status='running'
))) OR EXISTS (
  SELECT 1 FROM run_file_tasks caller JOIN task_runs run ON run.id=caller.run_id
  WHERE caller.task_id=download_tasks.id AND caller.paused=0 AND run.status='running'
))`

/** Distinct requests for one song run in order; different options never share a write. */
export const READY_DOWNLOAD_TASK_SQL = `${ELIGIBLE_DOWNLOAD_CALLERS_SQL}
  AND NOT EXISTS (
    SELECT 1 FROM download_tasks active WHERE active.song_id=download_tasks.song_id
      AND active.id!=download_tasks.id AND active.status IN ('downloading','tagging')
  ) AND NOT EXISTS (
    SELECT 1 FROM download_tasks earlier WHERE earlier.song_id=download_tasks.song_id
      AND earlier.status='pending'
      AND (earlier.created_at<download_tasks.created_at OR (earlier.created_at=download_tasks.created_at AND earlier.rowid<download_tasks.rowid))
      AND ${ELIGIBLE_DOWNLOAD_CALLERS_SQL.replaceAll('download_tasks.', 'earlier.')}
  )`

export function isRunDownloadPaused(runId: string): boolean {
  const db = getDb()
  createFileTaskSchema(db)
  const row = db.prepare('SELECT MIN(paused) AS paused FROM run_file_tasks WHERE run_id=?').get(runId) as { paused: number | null }
  return row.paused === 1
}

export function setRunDownloadPaused(runId: string, paused: boolean): number {
  const db = getDb()
  createFileTaskSchema(db)
  const count = db.transaction(() => {
    // Include old directly owned tasks which predate caller associations.
    db.prepare(`INSERT OR IGNORE INTO run_file_tasks(run_id,task_id,source_id,created_at)
      SELECT ?,id,source_id,created_at FROM download_tasks
      WHERE COALESCE(run_id,job_id)=? AND EXISTS(SELECT 1 FROM task_runs WHERE id=?)`).run(runId, runId, runId)
    return db.prepare('UPDATE run_file_tasks SET paused=? WHERE run_id=?').run(paused ? 1 : 0, runId).changes
  })()
  notify()
  return count
}

/** Withdraw this run's requests; another active caller may still need the file. */
export function cancelRunDownloads(runId: string): void {
  setRunDownloadPaused(runId, true)
  const tasks = getDb().prepare(`SELECT DISTINCT task_id FROM run_file_tasks cancelled
    WHERE cancelled.run_id=? AND NOT EXISTS (
      SELECT 1 FROM run_file_tasks caller JOIN task_runs run ON run.id=caller.run_id
      WHERE caller.task_id=cancelled.task_id AND caller.paused=0 AND run.status='running'
    )`).all(runId) as Array<{ task_id: string }>
  for (const task of tasks) activeDownloads.get(task.task_id)?.()
}

function notify() {
  emitEvent({ type: 'queue-update', data: { status: 'control-changed' }, timestamp: new Date().toISOString() })
}
