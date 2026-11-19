import { fail, success } from '../../../lib/response'
import { getRun } from '../../../lib/run/store'
import { isRunDownloadPaused, setRunDownloadPaused } from '../../../lib/download/queue-control'
import { requestDownloadProcessing } from '../../../lib/download/worker'
import { recoverDueFileTasks } from '../../../lib/download/recovery'
import { readConfigFromDb } from '../../../lib/db'

export default defineEventHandler(async event => {
  const id = getRouterParam(event, 'id')
  if (!id || !getRun(id)) return fail('运行记录不存在', 1, 'validation_failed')
  const body = await readBody<{ action?: string }>(event)
  if (body?.action !== 'pause' && body?.action !== 'resume') return fail('只支持暂停或继续下载', 1, 'validation_failed')
  const count = setRunDownloadPaused(id, body.action === 'pause')
  if (body.action === 'resume') {
    recoverDueFileTasks(readConfigFromDb())
    void requestDownloadProcessing().catch(() => undefined)
  }
  return success({ count, paused: isRunDownloadPaused(id) })
})
