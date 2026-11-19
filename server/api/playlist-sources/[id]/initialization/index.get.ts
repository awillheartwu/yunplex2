import { fail, success } from '../../../../lib/response'
import { getSource } from '../../../../lib/playlist/store'
import { getLatestInitialization } from '../../../../lib/source-initialization/store'
import { getPlexLibraryMonitorSnapshot } from '../../../../lib/plex-library-monitor'
import { deferredInitializationGroups, initializationProcessing } from '../../../../lib/source-initialization/presentation'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id') || ''
  const source = getSource(id)
  if (!source) return fail('歌单来源不存在')
  const initialization = getLatestInitialization(id)
  return success({
    applicable: source.type === 'playlist',
    initialization,
    deferredGroups: initialization ? deferredInitializationGroups(initialization.id) : [],
    processing: initializationProcessing(initialization),
    libraryChangedAt: getPlexLibraryMonitorSnapshot().libraryChangedAt,
  })
})
