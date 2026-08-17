import { success, fail } from '../../lib/response'
import { getSyncServiceInstance, isRepairRunning } from '../../lib/sync/instance'
import { isSyncMode, type SyncMode } from '../../lib/sync/service-state'
import { isGlobalSyncMode } from '../../lib/sync/mode-policy'

export default defineEventHandler(async (event) => {
  const syncService = getSyncServiceInstance()
  const state = syncService.getState()

  if (state.isRunning) return fail('同步任务已在运行中，请等待当前任务完成')
  if (isRepairRunning()) return fail('补全任务运行中，请等待完成')

  const body = await readBody<{ mode?: SyncMode }>(event)
  const mode = body?.mode
  if (!isSyncMode(mode) || !isGlobalSyncMode(mode)) {
    return fail('全局同步模式仅支持 normal、preview 或 full')
  }

  const { runId } = syncService.startSync({ mode, trigger: 'user' })

  const label = mode === 'preview' ? '预览同步' : mode === 'full' ? '全量同步' : '同步'
  return success({ triggered: true, runId }, `${label}已触发`)
})
