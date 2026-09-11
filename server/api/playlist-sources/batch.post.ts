import { requestSources } from '../../lib/sync/source-requests'
import { success, fail } from '../../lib/response'
import { applyPlaylistSourceBatchAction } from '../../lib/playlist/batch-actions'
import { getSyncWorker } from '../../lib/sync/instance'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ action?: unknown; ids?: unknown }>(event)

  if (body?.action === 'sync') {
    if (!Array.isArray(body.ids)) return fail('请选择要操作的同步源')
    try {
      const result = requestSources({ sourceIds: body.ids.filter((id): id is string => typeof id === 'string'), mode: 'normal', trigger: 'user' })
      if (result.triggered) void getSyncWorker()?.runOnce()
      return success({ ...result, action: 'sync', count: result.results.filter(item => item.status === 'accepted').length }, result.triggered ? '已按来源接受请求' : result.results[0]?.message)
    } catch (error) { return fail(error) }
  }

  try {
    const result = applyPlaylistSourceBatchAction(body?.action, body?.ids)
    getSyncWorker()?.update()

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
