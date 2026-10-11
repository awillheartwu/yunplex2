import { getDb } from '../db'
import { createFileTaskSchema } from '../db/file-task-schema'
import { emitEvent } from '../sync/events'

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
export const ELIGIBLE_DOWNLOAD_CALLERS_SQL = `(NOT EXISTS (
  SELECT 1 FROM run_file_tasks caller WHERE caller.task_id=download_tasks.id
) OR EXISTS (
  SELECT 1 FROM run_file_tasks caller WHERE caller.task_id=download_tasks.id AND caller.paused=0
))`

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

function notify() {
  emitEvent({ type: 'queue-update', data: { status: 'control-changed' }, timestamp: new Date().toISOString() })
}
