import type { ActivityRun, ActivitySnapshot } from '../../../shared/activity'
import type { SyncState } from '../log/types'
import type { TaskRunSummary } from '../job/types'
import { getDb } from '../db'
import { getQueueStatus, listDownloadTasks } from '../download/queue'
import { listRuns } from './store'

// One read snapshot keeps each task's file counts and visible rows in the same scope.
export function getActivitySnapshot(live: SyncState): ActivitySnapshot {
  return getDb().transaction(() => {
    const running = listRuns({ status: 'running', limit: 50 })
    const waiting = listRuns({ status: 'awaiting_action', limit: 50 })
    function project(run: TaskRunSummary): ActivityRun {
      const sources = getDb().prepare(`SELECT trs.source_id AS id,
        COALESCE(NULLIF(ps.name, ''), NULLIF(ps.netease_playlist_name, ''), trs.source_id) AS name
        FROM task_run_sources trs LEFT JOIN playlist_sources ps ON ps.id = trs.source_id
        WHERE trs.run_id = ? ORDER BY trs.source_id`).all(run.id) as { id: string; name: string }[]
      const tracksFiles = run.status === 'running' && run.sourceRequestStatus !== 'pending' && run.type !== 'source_initialization'
      const tasks = tracksFiles ? listDownloadTasks({ runId: run.id, status: 'downloading,tagging,pending', limit: 6 }) : null
      return {
        ...run,
        sourceIds: sources.map(source => source.id),
        sourceNames: sources.map(source => source.name),
        live: live.isRunning && live.currentRunId === run.id ? live : null,
        files: tasks ? { counts: getQueueStatus(run.id), items: tasks.items, total: tasks.total } : null,
      }
    }
    return {
      running: running.items.map(project), waiting: waiting.items.map(project),
      runningTotal: running.total, waitingTotal: waiting.total,
      unlistedLive: live.isRunning && !running.items.some(run => run.id === live.currentRunId) ? live : null,
      updatedAt: new Date().toISOString(),
    }
  })()
}
