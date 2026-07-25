import { success, fail } from '../../lib/response'
import { getSyncServiceInstance, isRepairRunning } from '../../lib/sync/instance'
import { recordActivityEvent } from '../../lib/activity/store'

export default defineEventHandler(async (event) => {
  const syncService = getSyncServiceInstance()
  const state = syncService.getState()

  if (state.isRunning) return fail('同步任务已在运行中，请等待当前任务完成')
  if (isRepairRunning()) return fail('补全任务运行中，请等待完成')

  const body = await readBody<{ dryRun?: boolean; forceFull?: boolean }>(event)
  const dryRun = body?.dryRun ?? false

  const { runId } = syncService.startSync({ dryRun, forceFull: body?.forceFull, trigger: 'user' })

  const label = dryRun ? '预览同步' : body?.forceFull ? '全量同步' : '同步'
  recordActivityEvent({
    domain: 'user',
    type: dryRun ? 'sync_preview_triggered' : body?.forceFull ? 'sync_full_triggered' : 'sync_triggered',
    severity: 'info',
    actor: 'user',
    title: `${label}已触发`,
    summary: dryRun ? '系统将按当前配置生成本轮变更预览。' : '本轮进度和结果将记录到运行详情中。',
    context: { dryRun, forceFull: body?.forceFull ?? false, jobId: runId },
    link: `/task-center/runs/${runId}`,
    groupKey: 'sync:manual-trigger',
  })
  return success({ triggered: true, runId }, `${label}已触发`)
})
