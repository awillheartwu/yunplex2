import { randomUUID } from 'node:crypto'
import { getDb, readConfigFromDb } from '../db'
import type { AppConfig } from '../config/types'
import type { PlaylistSource } from '../playlist/types'
import { getSource } from '../playlist/store'
import { resolveInitializationGate } from '../source-initialization/gate'
import { requestSourceInitialization } from '../source-initialization/requests'
import { getSyncServiceInstance, isRepairRunning } from './instance'
import { persistSourceRequest, sourceRequestsBusy, type SourceRequestInput } from './request-store'
import { isSyncMode, type SyncRunOptions } from './service-state'

export interface SourceRequestResult {
  sourceId: string
  sourceName?: string
  status: 'accepted' | 'awaiting_review' | 'busy' | 'failed'
  kind?: 'analysis' | 'convergence'
  requestId?: string | null
  initializationId?: string
  runId?: string | null
  message: string
}
export interface SourceRequestsResult {
  triggered: boolean
  batchId: string
  results: SourceRequestResult[]
}

/** Accept a batch atomically. The consumer owns every subsequent execution. */
export function requestSources(input: SyncRunOptions & { sourceIds: string[] }, busy?: () => boolean): SourceRequestsResult {
  const batchId = randomUUID()
  const sourceIds = [...new Set(input.sourceIds)]
  if (!sourceIds.length) throw new Error('没有可同步的歌单源')
  const mode = input.mode === undefined ? 'normal' : input.mode
  if (!isSyncMode(mode)) throw new Error('无效的同步模式')
  if (input.takeOverExternal !== undefined && typeof input.takeOverExternal !== 'boolean') throw new Error('无效的接管外部文件参数')
  if (input.takeOverExternal && mode !== 'redownload_managed') throw new Error('仅重新下载托管音频模式允许接管外部文件')
  const config = readConfigFromDb()
  const now = new Date()
  return getDb().transaction(() => {
    const sources = sourceIds.map(id => {
      const source = getSource(id)
      if (!source) throw new Error('歌单源不存在')
      if (mode === 'redownload_managed' && source.type !== 'playlist') throw new Error('重新下载托管音频仅支持歌单同步源')
      return source
    })
    if (sourceRequestsBusy() || (busy ? busy() : isRepairRunning() || getSyncServiceInstance().getState().isRunning)) {
      return { triggered: false, batchId, results: sources.map(source => ({ sourceId: source.id, sourceName: source.name, status: 'busy' as const, message: '已有来源任务或补全任务在运行中，请等待完成' })) }
    }
    const plans = sources.map(source => ({ source, gate: resolveInitializationGate(source, config) }))
    const ordered = [...plans.filter(p => p.gate.action === 'sync'), ...plans.filter(p => p.gate.action !== 'sync')]
    const results = ordered.map(({ source }, position) => ({ ...acceptSourceRequest(source, config, {
      ...input, sourceId: source.id, trigger: input.trigger ?? 'user', batchId, position, now,
    }), sourceName: source.name }))
    return { triggered: results.some(item => item.status === 'accepted'), batchId, results }
  })()
}

/** Shared routing for due schedules and an already validated manual batch. */
export function acceptSourceRequest(source: PlaylistSource, config: AppConfig, input: Omit<SourceRequestInput, 'kind'>): SourceRequestResult {
  const gate = resolveInitializationGate(source, config)
  if (gate.action === 'awaiting_review') return { sourceId: source.id, status: 'awaiting_review', initializationId: gate.initializationId, runId: gate.runId, message: '首次媒体接管等待确认' }
  if (gate.action === 'analyze') {
    const request = requestSourceInitialization(source.id, input.trigger, input.batchId ? { id: input.batchId, position: input.position ?? 0, mode: input.mode } : undefined, input.now)
    return { sourceId: source.id, status: 'accepted', kind: 'analysis', ...request, message: '已接受首次媒体接管分析' }
  }
  const requestId = persistSourceRequest({ ...input, kind: 'convergence', allowDisabled: input.trigger !== 'schedule' })
  return { sourceId: source.id, status: 'accepted', kind: 'convergence', requestId, message: '已接受同步请求' }
}

export interface SourceRequestSnapshot {
  id: string
  sourceId: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  kind: 'analysis' | 'convergence'
  runId: string | null
  error: string | null
}
