import { statSync } from 'node:fs'
import { join } from 'node:path'
import { getDataDir } from '../../lib/config/store'
import { getDb } from '../../lib/db'
import { getQueueStatus } from '../../lib/download/queue-status'
import { getEventClientCount } from '../../lib/sync/events'
import { getSyncWorker } from '../../lib/sync/instance'
import { getReadiness } from '../../lib/runtime/readiness'
import { success } from '../../lib/response'
import { getProcessMemorySample } from '../../lib/system-memory'

/** Authenticated, local-only diagnostics: no external probes, paths or credentials. */
export default defineEventHandler(() => {
  const db = getDb()
  const resourceCounts: Record<string, number> = {}
  for (const resource of process.getActiveResourcesInfo()) resourceCounts[resource] = (resourceCounts[resource] || 0) + 1
  const sizes = ['data.db', 'data.db-wal', 'data.db-shm'].map(file => {
    try { return statSync(join(getDataDir(), file)).size } catch { return 0 }
  })
  return success({
    pid: process.pid, uptime: process.uptime(), timestamp: Date.now(),
    ...getProcessMemorySample(), resourceCounts, sseClients: getEventClientCount(),
    readiness: getReadiness(), queue: getQueueStatus(), scheduler: getSyncWorker()?.getStatus() ?? null,
    databaseBytes: sizes.reduce((sum, size) => sum + size, 0),
    logs: db.prepare('SELECT COUNT(*) AS count FROM logs').get(),
    runs: db.prepare('SELECT COUNT(*) AS count FROM task_runs').get(),
  })
})
