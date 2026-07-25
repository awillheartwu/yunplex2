import { readConfig, setDataDir } from '../lib/config/store'
import { initDb } from '../lib/db'
import { getSyncService } from '../lib/sync/service'
import { startWorker } from '../lib/sync/worker'
import { setSyncService, setSyncWorker } from '../lib/sync/instance'
import { recoverInterruptedRuns } from '../lib/run/store'
import { backfillFailureRecords } from '../lib/tasks/failure-records'
import { recoverExpiredDownloadTasks } from '../lib/download/queue'

const DOWNLOAD_LEASE_SWEEP_INTERVAL_MS = 60 * 1000

export default defineNitroPlugin((nitroApp) => {
  const config = useRuntimeConfig()
  const dataDir = config.dataDir as string
  setDataDir(dataDir)

  initDb(dataDir)
  recoverInterruptedRuns()
  backfillFailureRecords()

  const svc = getSyncService(dataDir, () => readConfig())
  setSyncService(svc)

  const worker = startWorker(
    () => readConfig(),
    svc,
    dataDir,
  )
  setSyncWorker(worker)

  const leaseSweep = setInterval(() => {
    recoverExpiredDownloadTasks()
  }, DOWNLOAD_LEASE_SWEEP_INTERVAL_MS)
  leaseSweep.unref()
  nitroApp.hooks.hookOnce('close', () => {
    clearInterval(leaseSweep)
  })
})
