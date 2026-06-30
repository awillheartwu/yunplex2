import type { AppConfig } from '../config/types'
import type { SyncState } from '../log/types'

interface WorkerHandle {
  schedule: () => void
  update: () => void
  stop: () => void
  isScheduled: () => boolean
}

let worker: WorkerHandle | null = null

interface SyncServiceHandle {
  getState: () => SyncState
  runSync: (options?: { dryRun?: boolean; trigger?: 'schedule' }) => Promise<SyncState>
  cancelSync: () => boolean
}

export function getWorker() {
  return worker
}

export function startWorker(
  getConfig: () => AppConfig,
  syncService: SyncServiceHandle,
  _dataDir: string,
): WorkerHandle {
  if (worker) {
    stopWorker()
  }

  let timer: ReturnType<typeof setInterval> | null = null

  function schedule() {
    const cfg = getConfig()
    const minutes = Math.max(1, cfg.sync.intervalMinutes || 30)
    const ms = minutes * 60 * 1000

    if (timer) clearInterval(timer)
    timer = setInterval(async () => {
      const latestConfig = getConfig()
      if (!latestConfig.sync.enabled) {
        stop()
        return
      }
      const state = syncService.getState()
      if (state.isRunning) return
      try {
        await syncService.runSync({ trigger: 'schedule' })
      } catch {
        // Errors are logged inside runSync
      }
    }, ms)
  }

  function update() {
    const cfg = getConfig()
    if (!cfg.sync.enabled) {
      stop()
      return
    }
    schedule()
  }

  function stop() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  // Start immediately if enabled
  const cfg = getConfig()
  if (cfg.sync.enabled) {
    schedule()
  }

  function isScheduled() {
    return timer !== null
  }

  worker = { schedule, update, stop, isScheduled }

  return worker
}

export function stopWorker() {
  if (worker) {
    worker.stop()
    worker = null
  }
}
