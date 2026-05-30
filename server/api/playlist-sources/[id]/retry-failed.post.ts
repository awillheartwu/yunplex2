import { success, fail } from '../../../lib/response'
import { getSyncServiceInstance } from '../../../lib/sync/instance'
import { getSource, updateSource } from '../../../lib/playlist/store'
import { readConfig } from '../../../lib/config/store'
import { appendLog } from '../../../lib/log/store'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) return fail('缺少歌单源 ID')

  const source = getSource(id)
  if (!source) return fail('歌单源不存在')

  const syncService = getSyncServiceInstance()
  if (syncService.getState().isRunning) return fail('已有同步任务在运行中，请等待完成')

  // Count how many cached failures before clearing
  const restrictedCount = source.copyrightRestrictedIds
    ? JSON.parse(source.copyrightRestrictedIds).length
    : 0
  const ignoredCount = source.ignoredFailureIds
    ? Object.keys(JSON.parse(source.ignoredFailureIds)).length
    : 0
  const clearedCount = restrictedCount + ignoredCount

  if (clearedCount === 0) return fail('该歌单源没有失败缓存的歌曲')

  // Clear all failure caches
  updateSource(source.id, {
    copyrightRestrictedIds: null,
    ignoredFailureIds: null,
  })

  // Log
  const cfg = readConfig()
  const dataDir = (useRuntimeConfig() as any).dataDir as string
  appendLog(dataDir, {
    level: 'info',
    message: `[批量重试] 已清空 ${clearedCount} 首失败缓存（版权受限 ${restrictedCount} + 已忽略 ${ignoredCount}），触发增量同步: ${source.name}`,
    stage: 'download',
  }, cfg.sync.logRetentionDays ?? 30)

  // Trigger incremental sync (fire-and-forget)
  syncService.runSyncForSource(source.id).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[YunPlex2] retry-failed sync failed:', msg)
    appendLog(dataDir, { level: 'error', message: `[批量重试] 同步触发失败: ${source.name}`, detail: msg, stage: 'download' }, cfg.sync.logRetentionDays ?? 30)
  })

  return success({ triggered: true, sourceId: id, clearedCount }, `已清空 ${clearedCount} 首失败缓存，增量同步已触发`)
})
