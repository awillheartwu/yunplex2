import { success, fail } from '../../lib/response'
import { getSource } from '../../lib/playlist/store'
import { getPlexSourceNotice } from '../../lib/plex-library-monitor'
import { playlistWriteNotice } from '../../lib/sync/playlist-write-state'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  if (!id) return fail('缺少 ID')

  const source = getSource(id)
  if (!source) return fail('歌单源不存在')

  return success({ ...source, plexNotice: getPlexSourceNotice(id), pendingPlexWrite: playlistWriteNotice(id) })
})
