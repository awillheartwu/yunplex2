import { getDb } from '../db'
import type { AppConfig } from '../config/types'
import { getDownloadTask, requeueFailedDownloadTasks, type DownloadTask } from './queue'
import { ELIGIBLE_DOWNLOAD_CALLERS_SQL, getDownloadQueueControl } from './queue-control'
import { ACTIVE_RECOVERY_CALLER_SQL, getFileRecoveryTargets, inspectFileRecoveryTargets, type EnvironmentProblem } from '../tasks/recovery-targets'
import { scheduleSourceRecovery } from '../sync/recovery'
import { requestDownloadProcessing } from './worker'
import { resumePendingMediaRepairCommands } from './media-repair-command'

/** Resume only scheduled attempts; old stopped records and user ignores stay stopped. */
export function recoverDueFileTasks(config: AppConfig): void {
  if (getDownloadQueueControl().paused) return
  const db = getDb()
  const rows = db.prepare(`SELECT id FROM download_tasks task WHERE status='failed' AND next_retry_at<=?
    AND EXISTS (SELECT 1 FROM failure_records problem WHERE problem.status='open'
      AND INSTR(',' || COALESCE(problem.download_task_ids,'') || ',', ',' || task.id || ',')>0
      AND ${ACTIVE_RECOVERY_CALLER_SQL})
    ORDER BY updated_at`).all(new Date().toISOString()) as { id: string }[]
  const independent: string[] = []
  const sourceByTask = new Map<string, string | null>()
  for (const { id } of rows) {
    const targets = inspectFileRecoveryTargets(id, config)
    let acceptedBySource = false
    for (const { sourceId, route, eligible } of targets) {
      if (!eligible) continue
      if (route === 'source') {
        acceptedBySource = Boolean(scheduleSourceRecovery(sourceId!, config)) || acceptedBySource
      } else if (!sourceByTask.has(id)) {
        independent.push(id)
        sourceByTask.set(id, sourceId)
      }
    }
    if (!sourceByTask.has(id) && (acceptedBySource || !targets.some(target => target.eligible || target.temporary))) {
      db.prepare('UPDATE download_tasks SET next_retry_at=NULL WHERE id=?').run(id)
    }
    if (independent.length >= 100) break
  }
  if (independent.length && requeueFailedDownloadTasks(independent, { sourceByTask, trigger: 'system' }).length) void requestDownloadProcessing().catch(() => undefined)
  resumePendingMediaRepairCommands()
}

/** The probe sees the same eligible original destinations that recovery can resume. */
export function getFilesystemRecoveryTasks(config: AppConfig): DownloadTask[] {
  const rows = getDb().prepare(`SELECT id FROM download_tasks WHERE
    (status='pending' AND ${ELIGIBLE_DOWNLOAD_CALLERS_SQL})
    OR (status='failed' AND error_code='filesystem_failed')`).all() as { id: string }[]
  return rows.flatMap(({ id }) => {
    const task = getDownloadTask(id)!
    return task.status === 'pending' || getFileRecoveryTargets(id, config).length ? [task] : []
  })
}

/** Rearmed problems have already passed the store's attempt-generation guard. */
export function wakeEnvironmentFileTasks(code: string, problems: readonly EnvironmentProblem[], config: AppConfig): string[] {
  const sources = new Set<string>()
  const now = new Date().toISOString()
  for (const problem of problems) for (const taskId of problem.taskIds) {
    const targets = getFileRecoveryTargets(taskId, config).filter(target => target.sourceId === problem.sourceId)
    if (!targets.length) continue
    for (const target of targets) if (target.sourceId && target.route === 'source') sources.add(target.sourceId)
    getDb().prepare("UPDATE download_tasks SET next_retry_at=? WHERE id=? AND status='failed' AND error_code=?")
      .run(now, taskId, code)
  }
  return [...sources]
}
