import { getDb } from '../db'
import { createFileTaskSchema } from '../db/file-task-schema'
import { recoverInterruptedDownloadTasks } from '../download/queue'
import { getRun, saveRun, syncManualDownloadRun, syncRepairRun } from './store'

export function recoverInterruptedRuns(): number {
  const now = new Date().toISOString()
  let changed = recoverInterruptedDownloadTasks(now)

  const db = getDb()
  createFileTaskSchema(db)
  db.prepare(`
    UPDATE task_run_song_changes
    SET status = 'failed_download',
      phase = 'download',
      error_json = ?
    WHERE status = 'downloading'
  `).run(JSON.stringify({
    title: '重试中断',
    message: '任务因服务重启中断',
    stage: 'download',
    code: 'scheduler_interrupted',
  }))

  const rows = db.prepare("SELECT id FROM task_runs WHERE status = 'running'").all() as Array<{ id: string }>
  for (const row of rows) {
    const run = getRun(row.id)
    if (!run) continue
    const activeRequest = db.prepare(`
      SELECT 1 FROM source_sync_queue
      WHERE run_id = ? AND (
        (? = 'source_initialization' AND request_kind = 'analysis' AND status IN ('pending','running'))
        OR (status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at > ?)
      )
      LIMIT 1
    `).get(run.id, run.type, now)
    if (activeRequest) continue
    if (run.type === 'manual_download') {
      const synced = syncManualDownloadRun(run.id)
      if (synced?.status !== 'running') changed += 1
      continue
    }
    if (run.type === 'repair') {
      const repairTasks = db.prepare(`
        SELECT COUNT(*) AS count,
          SUM(CASE WHEN repair_task.status IN ('pending','downloading','tagging') THEN 1 ELSE 0 END) AS active
        FROM (
          SELECT task.id, task.status
          FROM run_file_tasks linked
          JOIN download_tasks task ON task.id = linked.task_id
          WHERE linked.run_id = ? AND task.operation = 'repair_existing'
          UNION
          SELECT task.id, task.status
          FROM download_tasks task
          WHERE COALESCE(task.run_id, task.job_id) = ? AND task.operation = 'repair_existing'
        ) repair_task
      `).get(run.id, run.id) as { count: number; active: number | null }
      if ((repairTasks.active ?? 0) > 0) {
        syncRepairRun(run.id)
        continue
      }
      // Media Repair has durable post-processing (Run projection + Plex refresh)
      // outside the file worker. Leave the Run recoverable even when every task
      // reached a terminal state just before the process stopped.
      if (repairTasks.count > 0) continue
      const synced = syncRepairRun(run.id)
      if (synced?.status !== 'running') changed += 1
      continue
    }
    run.status = 'failed'
    run.finishedAt = now
    run.durationMs = Math.max(0, Date.now() - new Date(run.startedAt).getTime())
    run.summary = run.summary ? `${run.summary}（服务重启后中断）` : '任务因服务重启中断'
    for (const step of run.steps) {
      if (step.status === 'running' || step.status === 'pending') {
        step.status = 'cancelled'
        step.finishedAt = now
      }
    }
    saveRun(run)
    changed += 1
  }
  return changed
}
