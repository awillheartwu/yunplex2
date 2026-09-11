import { success, fail } from '../../../lib/response'
import { startMediaRepairCommand } from '../../../lib/download/media-repair-command'
import { getSyncServiceInstance, isRepairRunning } from '../../../lib/sync/instance'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) return fail('缺少歌单源 ID')

  const syncService = getSyncServiceInstance()
  if (syncService.getState().isRunning) return fail('已有同步任务在运行中，请等待完成')
  if (isRepairRunning()) return fail('已有补全任务在运行中，请等待完成')

  try {
    const result = await startMediaRepairCommand(id)
    return success(
      { triggered: true, ...result },
      `补全任务已持久化，共 ${result.queuedSongs} 首待处理`,
    )
  } catch (error) {
    return fail(error instanceof Error ? error.message : '启动补全任务失败')
  }
})
