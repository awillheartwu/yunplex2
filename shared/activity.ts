import type { TaskRunSummary } from '../server/lib/job/types'
import type { DownloadTask, QueueStatus } from '../server/lib/download/queue'
import type { SyncState } from '../server/lib/log/types'

export interface ActivityRun extends TaskRunSummary {
  sourceIds: string[]
  sourceNames: string[]
  files: { counts: QueueStatus; items: DownloadTask[]; total: number } | null
  live: SyncState | null
}
export interface ActivitySnapshot {
  running: ActivityRun[]
  waiting: ActivityRun[]
  runningTotal: number
  waitingTotal: number
  unlistedLive: SyncState | null
  updatedAt: string
}
