import { fail, success } from '../../lib/response'
import { getRun, syncManualDownloadRun, syncRepairRun } from '../../lib/run/store'
import { getSyncServiceInstance } from '../../lib/sync/instance'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  if (!id) return fail('缺少运行 ID')
  const current = getRun(id)
  if (!current) return fail('运行记录不存在')
  if (current.type === 'sync' && current.status === 'running') {
    const live = getSyncServiceInstance().getCurrentRun()
    if (live?.id === id) return success({ ...current, ...live, trigger: current.trigger })
  }
  const run = current.type === 'manual_download'
    ? syncManualDownloadRun(id)
    : current.type === 'repair'
      ? syncRepairRun(id)
      : current
  return success(run)
})
