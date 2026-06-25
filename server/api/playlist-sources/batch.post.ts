import { success, fail } from '../../lib/response'
import { applyPlaylistSourceBatchAction } from '../../lib/playlist/batch-actions'
import { getSyncServiceInstance, isRepairRunning } from '../../lib/sync/instance'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ action?: unknown; ids?: unknown }>(event)
  const syncService = getSyncServiceInstance()

  try {
    const result = applyPlaylistSourceBatchAction(body?.action, body?.ids, {
      isSyncRunning: () => syncService.getState().isRunning,
      isRepairRunning,
      runSync: (ids) => {
        syncService.runSync({ sourceIds: ids }).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err)
          console.error('[YunPlex2] batch source sync failed:', msg)
        })
      },
    })

    const messages = {
      enable: `已启用 ${result.count} 个同步源`,
      disable: `已禁用 ${result.count} 个同步源`,
      delete: `已删除 ${result.count} 个同步源`,
      sync: `已触发 ${result.count} 个同步源同步`,
    }
    return success(result, messages[result.action])
  } catch (err) {
    return fail(err instanceof Error ? err.message : '批量操作失败')
  }
})
