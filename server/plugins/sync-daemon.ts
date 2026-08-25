import { readConfig, setDataDir } from '../lib/config/store'
import { initDb } from '../lib/db'
import { getSyncService } from '../lib/sync/service'
import { startWorker } from '../lib/sync/worker'
import { setSyncService, setSyncWorker } from '../lib/sync/instance'
import { recoverInterruptedRuns } from '../lib/run/store'
import { recoverExpiredDownloadTasks } from '../lib/download/queue'
import { appendLog } from '../lib/log/store'
import {
  dataLifecycleChangeCount,
  runDataLifecycleMaintenance,
} from '../lib/maintenance/data-lifecycle'

const DOWNLOAD_LEASE_SWEEP_INTERVAL_MS = 60 * 1000
const DATA_LIFECYCLE_INTERVAL_MS = 6 * 60 * 60 * 1000

export default defineNitroPlugin((nitroApp) => {
  const config = useRuntimeConfig()
  const dataDir = config.dataDir as string
  setDataDir(dataDir)

  initDb(dataDir)
  recoverInterruptedRuns()

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
  const lifecycleSweep = setInterval(maintainDataLifecycle, DATA_LIFECYCLE_INTERVAL_MS)
  lifecycleSweep.unref()
  nitroApp.hooks.hookOnce('close', () => {
    clearInterval(leaseSweep)
    clearInterval(lifecycleSweep)
  })
})
