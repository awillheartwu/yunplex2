import { fail, success } from '../../../../lib/response'
import { getSource } from '../../../../lib/playlist/store'
import { getLatestInitialization } from '../../../../lib/source-initialization/store'
import { readConfigFromDb } from '../../../../lib/db'
import { getSourceScheduleSnapshot } from '../../../../lib/sync/source-schedule-store'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id') || ''
  const source = getSource(id)
  if (!source) return fail('歌单来源不存在')
  const config = readConfigFromDb()
  return success({
    applicable: source.type === 'playlist',
    initialization: getLatestInitialization(id),
    downloadConcurrency: config.sync.downloadConcurrency,
    convergenceQueueDepth: getSourceScheduleSnapshot().queueDepth,
  })
})
