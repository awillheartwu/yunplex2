import { success, fail } from '../../../lib/response'
import { getSyncServiceInstance, isRepairRunning } from '../../../lib/sync/instance'
import { getSource } from '../../../lib/playlist/store'
import { getSourceFailureCounts } from '../../../lib/tasks/failure-records'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) return fail('缺少歌单源 ID')

  const source = getSource(id)
  if (!source) return fail('歌单源不存在')

  const syncService = getSyncServiceInstance()
  if (syncService.getState().isRunning) return fail('已有同步任务在运行中，请等待完成')
  if (isRepairRunning()) return fail('补全任务运行中，请等待完成')

  const counts = getSourceFailureCounts(source.id)
  const retryCount = counts.actionable + counts.copyrightRestricted

  if (retryCount === 0) return fail('该同步源没有可重新尝试的异常')

  // Clearing failure memory must be followed by a real comparison even when
  // the Netease playlist timestamp itself has not changed.
  const { runId } = syncService.startSyncForSource(source.id, { trigger: 'retry', mode: 'full' })

  return success({
    triggered: true,
    sourceId: id,
    retryCount,
    actionableFailureCount: counts.actionable,
    copyrightRestrictedCount: counts.copyrightRestricted,
    runId,
  }, `已开始重新尝试 ${retryCount} 个异常`)
})
