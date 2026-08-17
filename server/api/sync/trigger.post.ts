import { success, fail } from '../../lib/response'
import { getSyncServiceInstance, isRepairRunning } from '../../lib/sync/instance'
import { recordActivityEvent } from '../../lib/activity/store'
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
  recordActivityEvent({
    domain: 'user',
    type: mode === 'preview' ? 'sync_preview_triggered' : mode === 'full' ? 'sync_full_triggered' : 'sync_triggered',
    severity: 'info',
    actor: 'user',
    title: `${label}已触发`,
    summary: mode === 'preview' ? '系统将按当前配置生成本轮变更预览。' : '本轮进度和结果将记录到运行详情中。',
    context: { mode, jobId: runId },
    link: `/task-center/runs/${runId}`,
    groupKey: 'sync:manual-trigger',
  })
  return success({ triggered: true, runId }, `${label}已触发`)
})
