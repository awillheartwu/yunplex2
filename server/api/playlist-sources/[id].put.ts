import { success, fail } from '../../lib/response'
import { getSource, updateSourceSettings } from '../../lib/playlist/store'
import { getSyncWorker } from '../../lib/sync/instance'
import { isAudioQuality, type AudioQuality } from '../../../shared/audio-quality'
import { playlistWriteNotice } from '../../lib/sync/playlist-write-state'

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
    quality?: AudioQuality | null
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

  if (body.quality !== undefined && body.quality !== null && !isAudioQuality(body.quality)) return fail('请选择有效的音质，或使用全局设置')

  if (
    body.syncIntervalMinutes !== undefined
    && body.syncIntervalMinutes !== null
    && (!Number.isInteger(body.syncIntervalMinutes) || body.syncIntervalMinutes < 1 || body.syncIntervalMinutes > 1440)
  ) {
    return fail('同步间隔必须是 1 到 1440 分钟的整数')
  }

  const updated = updateSourceSettings(id, {
    name: body.name,
    enabled: body.enabled,
    plexPlaylistName: body.plexPlaylistName,
    plexPlaylistRatingKey: body.plexPlaylistRatingKey,
    syncLimit: body.syncLimit,
    quality: body.quality,
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

  return success({ ...updated, pendingPlexWrite: playlistWriteNotice(id) }, '歌单源更新成功')
})
