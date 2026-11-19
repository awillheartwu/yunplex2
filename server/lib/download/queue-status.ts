import { getDb } from '../db'
import { createFileTaskSchema } from '../db/file-task-schema'
import type { QueueStatus } from './queue'

export function getQueueStatus(runId?: string): QueueStatus {
  const db = getDb()
  if (runId) createFileTaskSchema(db)
  const scope = runId ? `WHERE COALESCE(dt.run_id, dt.job_id) = ? OR EXISTS (
    SELECT 1 FROM run_file_tasks link WHERE link.task_id = dt.id AND link.run_id = ?
  )` : ''
  const rows = db.prepare(
    `SELECT dt.status, COUNT(*) as cnt FROM download_tasks dt ${scope} GROUP BY dt.status`,
  ).all(...(runId ? [runId, runId] : [])) as { status: string; cnt: number }[]

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
