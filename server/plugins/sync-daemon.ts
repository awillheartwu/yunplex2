import { closeEventClients } from '../lib/sync/events'
import { validateTrustedProxies } from '../lib/auth/transport'
import { setRuntimePhase } from '../lib/runtime/readiness'
import { readConfig, setDataDir } from '../lib/config/store'
import { initDb } from '../lib/db'
import { getSyncService } from '../lib/sync/service'
import { startWorker, stopWorker } from '../lib/sync/worker'
import { recoverInterruptedSourceRequests } from '../lib/sync/source-schedule-store'
import { isRepairRunning, setSyncService, setSyncWorker, clearSyncWorker } from '../lib/sync/instance'
import { recoverInterruptedRuns } from '../lib/run/store'
import { recoverExpiredDownloadTasks } from '../lib/download/queue'
import { startDownloadWorker, stopDownloadWorker } from '../lib/download/worker'
import {
  resumePendingMediaRepairCommands,
  stopMediaRepairCommands,
  waitForMediaRepairCommands,
} from '../lib/download/media-repair-command'
import { appendLog } from '../lib/log/store'
import {
  dataLifecycleChangeCount,
  runDataLifecycleMaintenance,
} from '../lib/maintenance/data-lifecycle'
import { listRequestedPendingInitializations } from '../lib/source-initialization/store'
import { enqueueSourceInitialization } from '../lib/source-initialization/service'

const DOWNLOAD_LEASE_SWEEP_INTERVAL_MS = 60 * 1000
const DATA_LIFECYCLE_INTERVAL_MS = 6 * 60 * 60 * 1000
let daemonInitialized = false

export default defineNitroPlugin((nitroApp) => {
  if (daemonInitialized) return
  validateTrustedProxies()
  setRuntimePhase('starting')
  daemonInitialized = true
  const config = useRuntimeConfig()
  const dataDir = config.dataDir as string
  setDataDir(dataDir)

  initDb(dataDir)
  recoverInterruptedSourceRequests()
  recoverInterruptedRuns()
  startDownloadWorker(() => readConfig())

  const maintainDataLifecycle = () => {
    try {
      const appConfig = readConfig()
      const result = runDataLifecycleMaintenance(appConfig.sync)
      const changed = dataLifecycleChangeCount(result)
      if (changed > 0) {
        appendLog({
          level: 'info',
          message: `自动维护完成：清理 ${result.deletedLogs} 条诊断日志、${result.deletedRuns} 条运行、${result.deletedDownloadTasks} 条下载明细和 ${result.deletedResolvedFailures} 条已解决异常`,
          stage: 'maintenance',
        })
      }
    } catch (error) {
      console.error('[data-lifecycle] automatic maintenance failed', error)
    }
  }
  maintainDataLifecycle()

  const svc = getSyncService(() => readConfig())
  setSyncService(svc)
  resumePendingMediaRepairCommands()
  for (const initialization of listRequestedPendingInitializations()) {
    enqueueSourceInitialization(
      initialization.sourceId,
      initialization.trigger === 'schedule' ? 'schedule' : initialization.trigger === 'retry' ? 'retry' : 'user',
    )
  }

  const worker = startWorker(
    () => readConfig(),
    svc,
    dataDir,
    () => !isRepairRunning(),
  )
  setSyncWorker(worker)

  const leaseSweep = setInterval(() => {
    recoverExpiredDownloadTasks()
  }, DOWNLOAD_LEASE_SWEEP_INTERVAL_MS)
  leaseSweep.unref()
  const lifecycleSweep = setInterval(maintainDataLifecycle, DATA_LIFECYCLE_INTERVAL_MS)
  lifecycleSweep.unref()
  setRuntimePhase('ready')
  nitroApp.hooks.hookOnce('close', async () => {
    setRuntimePhase('stopping')
    closeEventClients()
    clearInterval(leaseSweep)
    clearInterval(lifecycleSweep)
    const results = await Promise.allSettled([
      stopWorker(),
      stopMediaRepairCommands(),
      stopDownloadWorker(),
    ])
    await waitForMediaRepairCommands()
    clearSyncWorker()
    daemonInitialized = false
    setRuntimePhase('stopped')
    if (results.some(result => result.status === 'rejected')) console.error('[shutdown] A consumer failed to stop cleanly')
  })
})
