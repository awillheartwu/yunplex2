import { success, fail } from '../../lib/response'
import { getSyncServiceInstance } from '../../lib/sync/instance'

export default defineEventHandler(async (event) => {
  const syncService = getSyncServiceInstance()
  const state = syncService.getState()

  if (state.isRunning) return fail('同步任务已在运行中，请等待当前任务完成')

  const body = await readBody<{ dryRun?: boolean; forceFull?: boolean }>(event)
  const dryRun = body?.dryRun ?? false

  // Fire and forget — frontend polls /api/sync/status for progress
  syncService.runSync({ dryRun, forceFull: body?.forceFull }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[YunPlex2] sync trigger failed:', msg)
  })

  const label = dryRun ? '预览同步' : body?.forceFull ? '全量同步' : '同步'
  return success({ triggered: true }, `${label}已触发`)
})
