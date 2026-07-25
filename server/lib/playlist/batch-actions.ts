import { deleteSource, getSource, updateSource } from './store'
import type { PlaylistSource } from './types'
import { recordActivityEvent } from '../activity/store'

export const PLAYLIST_SOURCE_BATCH_ACTIONS = ['enable', 'disable', 'delete', 'sync'] as const
export type PlaylistSourceBatchAction = typeof PLAYLIST_SOURCE_BATCH_ACTIONS[number]

export interface PlaylistSourceBatchResult {
  action: PlaylistSourceBatchAction
  count: number
  ids: string[]
  runId?: string
}

export interface PlaylistSourceBatchDeps {
  isSyncRunning?: () => boolean
  isRepairRunning?: () => boolean
  runSync?: (ids: string[]) => { runId: string } | void
  recordActivity?: typeof recordActivityEvent
}

function uniqueIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return []
  return Array.from(new Set(ids.map(id => String(id ?? '').trim()).filter(Boolean)))
}

export function isPlaylistSourceBatchAction(action: unknown): action is PlaylistSourceBatchAction {
  return typeof action === 'string' && PLAYLIST_SOURCE_BATCH_ACTIONS.includes(action as PlaylistSourceBatchAction)
}

function resolveBatchSources(ids: string[]): PlaylistSource[] {
  const sources = ids.map(id => getSource(id))
  const missing = ids.filter((_, index) => !sources[index])
  if (missing.length > 0) {
    throw new Error(`同步源不存在：${missing.join('、')}`)
  }
  return sources as PlaylistSource[]
}

function sourceName(source: PlaylistSource): string {
  return source.neteasePlaylistName || source.name
}

function recordBatchActivity(
  action: PlaylistSourceBatchAction,
  sources: PlaylistSource[],
  recordActivity: typeof recordActivityEvent,
  runId?: string,
) {
  const names = sources.map(sourceName).slice(0, 3)
  const suffix = sources.length > names.length ? ` 等 ${sources.length} 个来源` : ''
  const actionLabel: Record<PlaylistSourceBatchAction, string> = {
    enable: '批量启用同步源',
    disable: '批量停用同步源',
    delete: '批量删除同步源',
    sync: '批量同步来源',
  }

  recordActivity({
    domain: 'user',
    type: `source_batch_${action}`,
    severity: action === 'delete' || action === 'disable' ? 'warning' : 'info',
    actor: 'user',
    title: actionLabel[action],
    summary: `${actionLabel[action]}：${names.join('、')}${suffix}。`,
    context: { action, sourceIds: sources.map(source => source.id), sourceNames: sources.map(sourceName), ...(runId ? { jobId: runId } : {}) },
    link: runId ? `/task-center/runs/${runId}` : '/sync-sources',
    groupKey: `source:batch:${action}`,
  })
}

export function applyPlaylistSourceBatchAction(
  actionInput: unknown,
  idsInput: unknown,
  deps: PlaylistSourceBatchDeps = {},
): PlaylistSourceBatchResult {
  if (!isPlaylistSourceBatchAction(actionInput)) {
    throw new Error('不支持的批量操作')
  }

  const ids = uniqueIds(idsInput)
  if (ids.length === 0) {
    throw new Error('请选择要操作的同步源')
  }

  const sources = resolveBatchSources(ids)
  const recordActivity = deps.recordActivity ?? recordActivityEvent

  if (actionInput === 'sync') {
    const invalidType = sources.find(source => source.type !== 'playlist')
    if (invalidType) throw new Error('批量同步仅支持歌单来源')
    const disabled = sources.find(source => !source.enabled)
    if (disabled) throw new Error('批量同步仅支持已启用的歌单来源')
    if (deps.isSyncRunning?.()) throw new Error('同步任务已在运行中，请等待当前任务完成')
    if (deps.isRepairRunning?.()) throw new Error('补全任务运行中，请等待完成')
    const started = deps.runSync?.(ids)
    recordBatchActivity(actionInput, sources, recordActivity, started?.runId)
    return { action: actionInput, count: ids.length, ids, ...(started?.runId ? { runId: started.runId } : {}) }
  }

  if (actionInput === 'delete') {
    for (const source of sources) deleteSource(source.id)
    recordBatchActivity(actionInput, sources, recordActivity)
    return { action: actionInput, count: sources.length, ids }
  }

  const enabled = actionInput === 'enable'
  for (const source of sources) {
    if (source.type !== 'playlist') {
      throw new Error('批量启用/禁用仅支持歌单来源')
    }
  }
  for (const source of sources) {
    updateSource(source.id, { enabled })
  }
  recordBatchActivity(actionInput, sources, recordActivity)
  return { action: actionInput, count: sources.length, ids }
}
