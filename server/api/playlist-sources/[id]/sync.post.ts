import { success, fail } from '../../../lib/response'
import { getSyncServiceInstance } from '../../../lib/sync/instance'
import { getSource } from '../../../lib/playlist/store'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) return fail('缺少 ID')

  const source = getSource(id)
  if (!source) return fail('歌单源不存在')

  const syncService = getSyncServiceInstance()
  const state = syncService.getState()
  if (state.isRunning) return fail('已有同步任务在运行中，请等待完成')

  const body = await readBody<{ dryRun?: boolean; forceFull?: boolean }>(event)
  const dryRun = body?.dryRun ?? false
  const forceFull = body?.forceFull ?? false

  syncService.runSyncForSource(source.id, { dryRun, forceFull }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[YunPlex2] source sync failed:', msg)
  })

  return success({ triggered: true, sourceId: id }, `歌单源「${source.name}」同步已触发`)
})
