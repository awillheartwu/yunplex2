import type { AppConfig } from '../config/types'
import type { SyncState } from '../log/types'

interface WorkerHandle {
  schedule: () => void
  update: () => void
  stop: () => void
}

let worker: WorkerHandle | null = null

interface SyncServiceHandle {
  getState: () => SyncState
  runSync: (options?: { dryRun?: boolean }) => Promise<SyncState>
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
      const state = syncService.getState()
      if (state.isRunning) return
      try {
        await syncService.runSync()
      } catch {
        // Errors are logged inside runSync
      }
    }, ms)
  }

  function update() {
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

  worker = { schedule, update, stop }

  return worker
}

export function stopWorker() {
  if (worker) {
    worker.stop()
    worker = null
  }
}
