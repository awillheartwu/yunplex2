import { InitializationConflictError } from './errors'
import { randomUUID } from 'node:crypto'
import { getDb } from '../db'
import { getSource } from '../playlist/store'
import { getRun, saveRun } from '../run/store'
import type { TaskRun, TaskRunTrigger } from '../job/types'
import type { SyncMode } from '../sync/service-state'
import { getInitializationRequest, persistSourceRequest } from '../sync/request-store'
import { ensurePendingInitialization, getLatestInitialization, setInitializationStatus } from './store'

export function createInitializationRun(sourceId: string, sourceName: string, trigger: TaskRunTrigger): TaskRun {
  return {
    id: randomUUID(), type: 'source_initialization', trigger, startedAt: new Date().toISOString(), finishedAt: null,
    status: 'running', durationMs: 0, summary: '首次媒体接管已接受，等待分析', source: sourceName,
    sourceIds: [sourceId], target: 'Plex 媒体库', totalSongs: 0, successSongs: 0, failedSongs: 0,
    skippedSongs: 0, removedSongs: 0, warnings: 0, dryRun: true, steps: [], songs: [], config: {},
  }
}

export function requestSourceInitialization(sourceId: string, trigger: TaskRunTrigger = 'user', batch?: { id: string; position: number; mode?: SyncMode }, now?: Date) {
  return getDb().transaction(() => {
    const source = getSource(sourceId)
    if (!source || source.type !== 'playlist') throw new Error('首次媒体接管仅支持歌单来源')
    const latest = getLatestInitialization(sourceId)
    if (latest && ['completed', 'skipped'].includes(latest.status)) throw new InitializationConflictError('接管方案已结束，请刷新后重新分析')
    const initialization = ensurePendingInitialization(sourceId, trigger)
    if (initialization.status === 'applying') throw new InitializationConflictError('首次媒体接管方案正在应用')
    const existing = getInitializationRequest(initialization.id)
    if (existing || initialization.status === 'awaiting_review') {
      return { initializationId: initialization.id, runId: initialization.runId!, requestId: existing?.id ?? null }
    }
    const run = initialization.runId ? getRun(initialization.runId) : null
    const prepared = run ?? createInitializationRun(source.id, source.name, trigger)
    saveRun({ ...prepared, status: 'running', finishedAt: null, summary: '首次媒体接管已接受，等待分析' })
    setInitializationStatus(initialization.id, 'pending', { runId: prepared.id, error: null })
    const requestId = persistSourceRequest({ sourceId, kind: 'analysis', trigger, initializationId: initialization.id,
      runId: prepared.id, mode: batch?.mode, allowDisabled: trigger !== 'schedule', batchId: batch?.id, position: batch?.position, now })
    return { initializationId: initialization.id, runId: prepared.id, requestId }
  })()
}

export function restartSourceInitialization(sourceId: string, expectedInitializationId: string) {
  return getDb().transaction(() => {
    const latest = getLatestInitialization(sourceId)
    if (!latest || latest.id !== expectedInitializationId) throw new InitializationConflictError('接管方案已变化，请刷新后重新操作')
    if (latest.status === 'applying') throw new InitializationConflictError('首次媒体接管方案正在应用，不能重新分析')
    const request = getInitializationRequest(latest.id)
    if (latest.status === 'analyzing' || (latest.status === 'pending' && request)) {
      return { initializationId: latest.id, runId: latest.runId!, requestId: request?.id ?? null }
    }
    setInitializationStatus(latest.id, 'cancelled', { summary: '用户要求重新分析', error: null })
    if (latest.runId) {
      const run = getRun(latest.runId)
      if (run) saveRun({ ...run, status: 'cancelled', finishedAt: new Date().toISOString(), summary: '用户要求重新分析' })
    }
    return requestSourceInitialization(sourceId)
  })()
}
