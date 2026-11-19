import { setTimeout } from 'node:timers/promises'
import { getDb } from '../db'
import { cancelRunDownloads } from '../download/queue-control'
import { stopMediaRepairCommands } from '../download/media-repair-command'
import { getRun, saveRun } from '../run/store'
import { getSyncServiceInstance } from '../sync/instance'
import { cancelSourceRequests } from '../sync/source-request-cancellation'
import { deleteSource, getSource, updateSource } from './store'

/** Finish this source's work before removing its configuration and caller attribution. */
export async function deleteSourceAndStopWork(sourceId: string): Promise<boolean> {
  if (!getSource(sourceId)) return false
  const db = getDb(), service = getSyncServiceInstance()
  updateSource(sourceId, { enabled: false })
  cancelSourceRequests(() => {
    const currentId = service.getState().currentRunId
    const currentRequest = currentId && db.prepare("SELECT 1 FROM source_sync_queue WHERE source_id=? AND run_id=? AND status='running'").get(sourceId, currentId)
    return currentRequest || service.getCurrentRun()?.sourceIds?.includes(sourceId) ? service.cancelSync() : false
  }, sourceId)
  const runs = db.prepare(`SELECT DISTINCT run.id,run.type FROM task_runs run
    WHERE run.status IN ('running','awaiting_action') AND (
      EXISTS (SELECT 1 FROM task_run_sources source WHERE source.run_id=run.id AND source.source_id=?)
      OR EXISTS (SELECT 1 FROM run_file_tasks caller WHERE caller.run_id=run.id AND caller.source_id=?)
    )`).all(sourceId, sourceId) as Array<{ id: string; type: string }>
  for (const { id } of runs) {
    cancelRunDownloads(id)
    const run = getRun(id)
    if (run) saveRun({ ...run, status: 'cancelled', finishedAt: new Date().toISOString(), summary: '收藏已删除，本次处理已取消' })
  }
  if (runs.some(run => run.type === 'repair')) await stopMediaRepairCommands()
  while (db.prepare("SELECT 1 FROM source_sync_queue WHERE source_id=? AND status='running'").get(sourceId)
    || service.getCurrentRun()?.sourceIds?.includes(sourceId)) {
    await setTimeout(50)
  }
  return deleteSource(sourceId)
}
