import { deleteSource, getSource, updateSource } from './store'
import type { PlaylistSource } from './types'

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
  if (actionInput === 'sync') {
    const invalidType = sources.find(source => source.type !== 'playlist')
    if (invalidType) throw new Error('批量同步仅支持歌单来源')
    const disabled = sources.find(source => !source.enabled)
    if (disabled) throw new Error('批量同步仅支持已启用的歌单来源')
    if (deps.isSyncRunning?.()) throw new Error('同步任务已在运行中，请等待当前任务完成')
    if (deps.isRepairRunning?.()) throw new Error('补全任务运行中，请等待完成')
    const started = deps.runSync?.(ids)
    return { action: actionInput, count: ids.length, ids, ...(started?.runId ? { runId: started.runId } : {}) }
  }

  if (actionInput === 'delete') {
    for (const source of sources) deleteSource(source.id)
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
  return { action: actionInput, count: sources.length, ids }
}
