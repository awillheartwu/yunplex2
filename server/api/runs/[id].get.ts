import { fail, success } from '../../lib/response'
import { getRun, syncManualDownloadRun, syncRepairRun } from '../../lib/run/store'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  if (!id) return fail('缺少运行 ID')
  const current = getRun(id)
  if (!current) return fail('运行记录不存在')
  const run = current.type === 'manual_download'
    ? syncManualDownloadRun(id)
    : current.type === 'repair'
      ? syncRepairRun(id)
      : current
  return success(run)
})
