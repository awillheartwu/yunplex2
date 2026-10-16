import { fail, success } from '../../../../lib/response'
import { getSource } from '../../../../lib/playlist/store'
import { getLatestInitialization } from '../../../../lib/source-initialization/store'
import { readConfigFromDb } from '../../../../lib/db'
import { getSourceScheduleSnapshot } from '../../../../lib/sync/source-schedule-store'
import { getPlexLibraryMonitorSnapshot } from '../../../../lib/plex-library-monitor'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id') || ''
  const source = getSource(id)
  if (!source) return fail('歌单来源不存在')
  const config = readConfigFromDb()
  return success({
    applicable: source.type === 'playlist',
    initialization: getLatestInitialization(id),
    libraryChangedAt: getPlexLibraryMonitorSnapshot().libraryChangedAt,
    downloadConcurrency: config.sync.downloadConcurrency,
    convergenceQueueDepth: getSourceScheduleSnapshot().queueDepth,
  })
})
