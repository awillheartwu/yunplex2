import { randomUUID } from 'node:crypto'
import type { AppConfig } from '../config/types'
import type { SyncState } from '../log/types'
import {
  claimNextSourceRequest,
  finishSourceRequest,
  getSourceScheduleSnapshot,
  reconcileSourceSchedules,
  recoverInterruptedSourceRequests,
  renewSourceRequestLease,
  type SourceScheduleSnapshot,
} from './source-schedule-store'

const SCHEDULER_POLL_MS = 15_000
const LEASE_HEARTBEAT_MS = 30_000

export interface SourceSchedulerStatus extends SourceScheduleSnapshot {
  enabled: boolean
  scheduled: boolean
  heartbeatAt: string | null
  workerId: string
}

interface WorkerHandle {
  schedule: () => void
  update: () => void
  stop: () => Promise<void>
  isScheduled: () => boolean
  runOnce: () => Promise<void>
  getStatus: () => SourceSchedulerStatus
}

let worker: WorkerHandle | null = null

interface SyncServiceHandle {
  getState: () => SyncState
  runSyncForSource: (sourceId: string, options?: { mode?: 'normal'; trigger?: 'schedule' }) => Promise<SyncState>
  cancelSync: () => boolean
}

export function getWorker() {
  return worker
}

/**
 * Single consumer for persisted Source Convergence Requests.
 * Scheduling and lease rules stay behind source-schedule-store's interface;
 * this module only drives the consumer lifecycle.
 */
export function startWorker(
  getConfig: () => AppConfig,
  syncService: SyncServiceHandle,
  _dataDir: string,
): WorkerHandle {
  if (worker) throw new Error('Source scheduler is already started')

  const workerId = `source-scheduler:${process.pid}:${randomUUID().slice(0, 8)}`
  let timer: ReturnType<typeof setInterval> | null = null
  let stopping = false
  let heartbeatAt: string | null = null
  let currentTick: Promise<void> | null = null

  recoverInterruptedSourceRequests()

  async function executeOnce(): Promise<void> {
    let config = getConfig()
    heartbeatAt = new Date().toISOString()
    reconcileSourceSchedules(config)
    if (!config.sync.enabled || syncService.getState().isRunning) return

    while (!stopping && config.sync.enabled && !syncService.getState().isRunning) {
      const request = claimNextSourceRequest(workerId)
      if (!request) break
      const leaseHeartbeat = setInterval(() => {
        heartbeatAt = new Date().toISOString()
        renewSourceRequestLease(request.id, workerId)
      }, LEASE_HEARTBEAT_MS)
      leaseHeartbeat.unref()
      try {
        const state = await syncService.runSyncForSource(request.sourceId, {
          mode: 'normal',
          trigger: 'schedule',
        })
        const result = state.lastSyncResult ?? 'failure'
        finishSourceRequest(
          request,
          result,
          getConfig(),
          result === 'failure' ? state.failures.at(-1)?.reason ?? '来源同步失败' : null,
        )
      } catch (error) {
        finishSourceRequest(
          request,
          'failure',
          getConfig(),
          error instanceof Error ? error.message : String(error),
        )
      } finally {
        clearInterval(leaseHeartbeat)
        heartbeatAt = new Date().toISOString()
      }
      config = getConfig()
      reconcileSourceSchedules(config)
    }
  }

  function runOnce(): Promise<void> {
    if (stopping) return Promise.resolve()
    if (currentTick) return currentTick
    currentTick = executeOnce().finally(() => { currentTick = null })
    return currentTick
  }

  function schedule() {
    stopping = false
    if (timer) clearInterval(timer)
    timer = setInterval(() => { void runOnce() }, SCHEDULER_POLL_MS)
    timer.unref()
    void runOnce()
  }

  function update() {
    const config = getConfig()
    if (!config.sync.enabled) {
      if (timer) clearInterval(timer)
      timer = null
      reconcileSourceSchedules(config)
      return
    }
    schedule()
  }

  async function stop() {
    stopping = true
    if (timer) clearInterval(timer)
    timer = null
    await currentTick
  }

  function isScheduled() {
    return timer !== null
  }

  function getStatus(): SourceSchedulerStatus {
    return {
      enabled: getConfig().sync.enabled,
      scheduled: isScheduled(),
      heartbeatAt,
      workerId,
      ...getSourceScheduleSnapshot(),
    }
  }

  worker = { schedule, update, stop, isScheduled, runOnce, getStatus }
  if (getConfig().sync.enabled) schedule()
  else reconcileSourceSchedules(getConfig())
  return worker
}

export async function stopWorker() {
  if (!worker) return
  const current = worker
  worker = null
  await current.stop()
}
