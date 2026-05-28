import { success, fail } from '../../lib/response'
import { getSource, updateSource } from '../../lib/playlist/store'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) return fail('缺少 ID')

  if (!getSource(id)) return fail('歌单源不存在')

  const body = await readBody<{
    name?: string
    enabled?: boolean
    plexPlaylistName?: string
    plexPlaylistRatingKey?: string
    syncLimit?: number | null
    autoCreatePlexPlaylist?: boolean
    forceFullCompare?: boolean
  }>(event)

  const updated = updateSource(id, {
    name: body.name,
    enabled: body.enabled,
    plexPlaylistName: body.plexPlaylistName,
    plexPlaylistRatingKey: body.plexPlaylistRatingKey,
    syncLimit: body.syncLimit,
    autoCreatePlexPlaylist: body.autoCreatePlexPlaylist,
    forceFullCompare: body.forceFullCompare,
  })

  return success(updated, '歌单源更新成功')
})
