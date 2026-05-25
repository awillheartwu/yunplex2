import { success, fail } from '../../lib/response'
import { getSyncServiceInstance } from '../../lib/sync/instance'

export default defineEventHandler(async (event) => {
  const syncService = getSyncServiceInstance()
  const state = syncService.getState()

  if (state.isRunning) return fail('同步任务已在运行中，请等待当前任务完成')

  const body = await readBody<{ dryRun?: boolean }>(event)
  const dryRun = body?.dryRun ?? false

  // Fire and forget — frontend polls /api/sync/status for progress
  syncService.runSync({ dryRun }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[YunPlex2] sync trigger failed:', msg)
  })

  return success({ triggered: true }, dryRun ? '预览同步已触发' : '同步任务已触发')
})
