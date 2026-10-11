import { fail, success } from '../../lib/response'
import { getDownloadQueueControl, pauseDownloadQueue, resumeDownloadQueue } from '../../lib/download/queue-control'
import { requestDownloadProcessing } from '../../lib/download/worker'

export default defineEventHandler(async event => {
  const body = await readBody<{ action?: string }>(event)
  if (body?.action === 'pause') pauseDownloadQueue('manual', '已暂停领取新任务，当前文件处理完成后停止。')
  else if (body?.action === 'resume') {
    resumeDownloadQueue()
    void requestDownloadProcessing().catch(() => undefined)
  } else return fail('只支持暂停或继续下载', 1, 'validation_failed')
  return success(getDownloadQueueControl())
})
