import { randomUUID } from 'node:crypto'
import type { AppConfig } from '../config/types'
import type { SyncState } from '../log/types'
import { getDb } from '../db'
import { getRun, saveRun } from '../run/store'
import { getSource } from '../playlist/store'
import { resolveInitializationGate } from '../source-initialization/gate'
import { analyzeSourceInitialization, commitSourceInitialization, stopInitializationAnalyses } from '../source-initialization/service'
import type { SyncRunOptions } from './service-state'
import { getLatestInitialization, setInitializationStatus } from '../source-initialization/store'
import {
  claimNextSourceRequest,
  attachSourceRequestRun,
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
  prepareSyncForSource: (sourceId: string, options?: SyncRunOptions) => {
    runId: string
    run: () => Promise<SyncState>
  }
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
  canStartConvergence: () => boolean = () => true,
): WorkerHandle {
  if (worker) return worker

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
    if (syncService.getState().isRunning || !canStartConvergence()) return

    while (
      !stopping
      && !syncService.getState().isRunning
      && canStartConvergence()
    ) {
      const request = claimNextSourceRequest(workerId)
      if (!request) break
      const leaseHeartbeat = setInterval(() => {
        heartbeatAt = new Date().toISOString()
        renewSourceRequestLease(request.id, workerId)
      }, LEASE_HEARTBEAT_MS)
      leaseHeartbeat.unref()
      try {
        const source = getSource(request.sourceId)
        const gate = source ? resolveInitializationGate(source, config) : { action: 'sync' as const }
        const cancelled = (getDb().prepare('SELECT cancel_requested_at FROM source_sync_queue WHERE id=?').get(request.id) as { cancel_requested_at: string | null }).cancel_requested_at
        if (cancelled) {
          if (request.kind === 'initialization_apply') getDb().prepare("UPDATE initialization_quick_operations SET status='cancelled' WHERE request_id=?").run(request.id)
          if (request.initializationId) {
            setInitializationStatus(request.initializationId, 'cancelled', { summary: '用户取消分析' })
            const run = request.runId ? getRun(request.runId) : null
            if (run) saveRun({ ...run, status: 'cancelled', finishedAt: new Date().toISOString(), summary: '用户取消分析' })
          }
          finishSourceRequest(request, 'success', getConfig(), '用户取消')
          continue
        }
        if (request.kind === 'initialization_apply') {
          const operationId = request.followUpOf?.replace(/^quick:/, '')
          const id = (getDb().prepare('SELECT initialization_id FROM initialization_quick_operations WHERE id=?').get(operationId) as {initialization_id:string} | undefined)?.initialization_id
          if (!id) throw new Error('快速处理请求缺少草案')
          await commitSourceInitialization(id, true)
          getDb().prepare("UPDATE initialization_quick_operations SET status='executed' WHERE initialization_id=? AND status='queued'").run(id)
          finishSourceRequest(request, 'success', getConfig(), null)
          continue
        }
        if (request.kind === 'analysis') {
          if (stopping) break
          await analyzeSourceInitialization(request.sourceId, request.trigger, request.initializationId ?? undefined)
          finishSourceRequest(request, 'success', getConfig(), null)
          continue
        }
        if (gate.action !== 'sync' && request.followUpOf?.startsWith('identity:')) {
          getDb().prepare("UPDATE source_sync_queue SET status='pending',lease_owner=NULL,lease_expires_at=NULL,available_at=?,last_error='等待首次接管完成后对齐' WHERE id=?").run(new Date(Date.now()+15_000).toISOString(),request.id)
          continue
        }
        if (gate.action !== 'sync') {
          throw new Error('来源尚未完成首次媒体接管，普通同步已阻止')
        }
        const prepared = syncService.prepareSyncForSource(request.sourceId, {
          mode: request.mode,
          trigger: request.trigger,
          ...(request.takeOverExternal ? { takeOverExternal: true } : {}),
        })
        if (!attachSourceRequestRun(request, prepared.runId)) {
          throw new Error('调度请求租约已失效，未启动来源同步')
        }
        if (request.followUpOf) {
          const initialization = getLatestInitialization(request.sourceId)
          if (initialization?.id === request.followUpOf && initialization.runId) {
            getDb().transaction(() => {
              setInitializationStatus(initialization.id, 'completed', { followUpRunId: prepared.runId })
              getDb().prepare("INSERT OR REPLACE INTO task_run_links (run_id, related_run_id, relation) VALUES (?, ?, 'initialization_follow_up')").run(initialization.runId, prepared.runId)
              getDb().prepare("INSERT OR REPLACE INTO task_run_links (run_id, related_run_id, relation) VALUES (?, ?, 'follow_up_of')").run(prepared.runId, initialization.runId)
            })()
          }
        }
        const running = prepared.run()
        const state = await running
        const result = state.lastSyncResult ?? 'failure'
        finishSourceRequest(
          request,
          result,
          getConfig(),
          result === 'failure' ? state.failures.at(-1)?.reason ?? '来源同步失败' : null,
        )
      } catch (error) {
        if (stopping) {
          getDb().prepare("UPDATE source_sync_queue SET status='pending', lease_owner=NULL, lease_expires_at=NULL WHERE id=? AND lease_owner=?").run(request.id, workerId)
          if (request.initializationId) {
            setInitializationStatus(request.initializationId, 'pending', { error: '服务停止，等待恢复分析' })
            const run = request.runId ? getRun(request.runId) : null
            if (run) saveRun({ ...run, status: 'running', finishedAt: null, summary: '服务停止，等待恢复分析' })
          }
          break
        }
        if (request.kind === 'initialization_apply') getDb().prepare("UPDATE initialization_quick_operations SET status='failed' WHERE request_id=?").run(request.id)
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

  function schedule(startImmediately = true) {
    stopping = false
    if (timer) clearInterval(timer)
    timer = setInterval(() => { void runOnce() }, SCHEDULER_POLL_MS)
    timer.unref()
    if (startImmediately) void runOnce()
  }

  function update() {
    const config = getConfig()
    reconcileSourceSchedules(config)
    schedule()
  }

  async function stop() {
    stopping = true
    stopInitializationAnalyses()
    syncService.cancelSync()
    if (timer) clearInterval(timer)
    timer = null
    await currentTick
  }

  function isScheduled() {
    return timer !== null && getConfig().sync.enabled
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
  schedule(getConfig().sync.enabled || getSourceScheduleSnapshot().queueDepth > 0)
  return worker
}

export async function stopWorker() {
  if (!worker) return
  const current = worker
  worker = null
  await current.stop()
}
