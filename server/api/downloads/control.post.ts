import { fail, success } from '../../lib/response'
import { getDownloadQueueControl, pauseDownloadQueue } from '../../lib/download/queue-control'
import { resumeDownloadsAfterRepair } from '../../lib/download/environment-recovery'

export default defineEventHandler(async event => {
  const body = await readBody<{ action?: string }>(event)
  if (body?.action === 'pause') pauseDownloadQueue('manual', '已暂停领取新任务，当前文件处理完成后停止。')
  else if (body?.action === 'resume') {
    try { await resumeDownloadsAfterRepair() }
    catch (error) { return fail(error instanceof Error ? error.message : '恢复下载失败') }
  } else return fail('只支持暂停或继续下载', 1, 'validation_failed')
  return success(getDownloadQueueControl())
})
