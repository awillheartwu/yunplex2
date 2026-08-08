import { success, fail } from '../../../lib/response'
import { getSyncServiceInstance, isRepairRunning } from '../../../lib/sync/instance'
import { getSource, updateSource } from '../../../lib/playlist/store'
import { readConfig } from '../../../lib/config/store'
import { appendLog } from '../../../lib/log/store'
import {
  countCopyrightRestrictedEntries,
  countFailureCacheEntries,
  failureCacheTotal,
  formatFailureCacheRetryLabel,
} from '~~/lib/failure-cache-presentation'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) return fail('缺少歌单源 ID')

  const source = getSource(id)
  if (!source) return fail('歌单源不存在')

  const syncService = getSyncServiceInstance()
  if (syncService.getState().isRunning) return fail('已有同步任务在运行中，请等待完成')
  if (isRepairRunning()) return fail('补全任务运行中，请等待完成')

  // Count how many cached failures before clearing
  const counts = {
    continuousFailure: countFailureCacheEntries(source.ignoredFailureIds),
    copyrightRestricted: countCopyrightRestrictedEntries(source.copyrightRestrictedIds),
  }
  const clearedCount = failureCacheTotal(counts)

  if (clearedCount === 0) return fail('该同步源没有失败缓存或版权受限记录')

  // Clear all failure caches
  updateSource(source.id, {
    copyrightRestrictedIds: null,
    ignoredFailureIds: null,
  })

  // Log
  const cfg = readConfig()
  const dataDir = useRuntimeConfig(event).dataDir
  appendLog(dataDir, {
    level: 'info',
    message: `[批量重试] ${formatFailureCacheRetryLabel(counts)}：${source.name}`,
    stage: 'download',
  }, cfg.sync.logRetentionDays ?? 30)

  // Clearing failure memory must be followed by a real comparison even when
  // the Netease playlist timestamp itself has not changed.
  const { runId } = syncService.startSyncForSource(source.id, { trigger: 'retry', forceFull: true })

  return success({
    triggered: true,
    sourceId: id,
    clearedCount,
    continuousFailureCount: counts.continuousFailure,
    copyrightRestrictedCount: counts.copyrightRestricted,
    runId,
  }, formatFailureCacheRetryLabel(counts))
})
