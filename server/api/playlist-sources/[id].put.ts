import { success, fail } from '../../lib/response'
import { getSource, updateSource } from '../../lib/playlist/store'
import { getSyncWorker } from '../../lib/sync/instance'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) return fail('缺少 ID')

  const existing = getSource(id)
  if (!existing) return fail('歌单源不存在')

  const body = await readBody<{
    name?: string
    enabled?: boolean
    plexPlaylistName?: string
    plexPlaylistRatingKey?: string
    syncLimit?: number | null
    syncIntervalMinutes?: number | null
    autoCreatePlexPlaylist?: boolean
    forceFullCompare?: boolean | null
    fullCompareAfterSkips?: number | null
    fullCompareAfterDays?: number | null
    skipPlexPlaylist?: boolean | null
    skipRemoveExtraTracks?: boolean | null
    initializeMediaOnFirstSync?: boolean | null
    neteasePlaylistName?: string
  }>(event)

  if (
    body.syncIntervalMinutes !== undefined
    && body.syncIntervalMinutes !== null
    && (!Number.isInteger(body.syncIntervalMinutes) || body.syncIntervalMinutes < 1 || body.syncIntervalMinutes > 1440)
  ) {
    return fail('同步间隔必须是 1 到 1440 分钟的整数')
  }

  const updated = updateSource(id, {
    name: body.name,
    enabled: body.enabled,
    plexPlaylistName: body.plexPlaylistName,
    plexPlaylistRatingKey: body.plexPlaylistRatingKey,
    syncLimit: body.syncLimit,
    syncIntervalMinutes: body.syncIntervalMinutes,
    nextSyncAt: body.syncIntervalMinutes !== undefined ? null : undefined,
    autoCreatePlexPlaylist: body.autoCreatePlexPlaylist,
    forceFullCompare: body.forceFullCompare,
    fullCompareAfterSkips: body.fullCompareAfterSkips,
    fullCompareAfterDays: body.fullCompareAfterDays,
    skipPlexPlaylist: body.skipPlexPlaylist,
    skipRemoveExtraTracks: body.skipRemoveExtraTracks,
    initializeMediaOnFirstSync: body.initializeMediaOnFirstSync,
    neteasePlaylistName: body.neteasePlaylistName,
  })

  getSyncWorker()?.update()

  return success(updated, '歌单源更新成功')
})
