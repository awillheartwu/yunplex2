import { success, fail } from '../../lib/response'
import { getSource, updateSource } from '../../lib/playlist/store'
import { recordActivityEvent } from '../../lib/activity/store'
import { readConfig } from '../../lib/config/store'
import { enablesMissingMediaPolicy } from '../../lib/sync/effective-settings'

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
    autoCreatePlexPlaylist?: boolean
    forceFullCompare?: boolean | null
    downloadWhenMediaMissing?: boolean | null
    fullCompareAfterSkips?: number | null
    fullCompareAfterDays?: number | null
    skipPlexPlaylist?: boolean | null
    skipRemoveExtraTracks?: boolean | null
    neteasePlaylistName?: string
    copyrightRestrictedIds?: string | null
    ignoredFailureIds?: string | null
  }>(event)

  const globalDownloadWhenMissing = readConfig().sync.downloadWhenMediaMissing

  const updated = updateSource(id, {
    name: body.name,
    enabled: body.enabled,
    plexPlaylistName: body.plexPlaylistName,
    plexPlaylistRatingKey: body.plexPlaylistRatingKey,
    syncLimit: body.syncLimit,
    autoCreatePlexPlaylist: body.autoCreatePlexPlaylist,
    forceFullCompare: body.forceFullCompare,
    downloadWhenMediaMissing: body.downloadWhenMediaMissing,
    fullCompareAfterSkips: body.fullCompareAfterSkips,
    fullCompareAfterDays: body.fullCompareAfterDays,
    skipPlexPlaylist: body.skipPlexPlaylist,
    skipRemoveExtraTracks: body.skipRemoveExtraTracks,
    neteasePlaylistName: body.neteasePlaylistName,
    copyrightRestrictedIds: body.copyrightRestrictedIds,
    ignoredFailureIds: body.ignoredFailureIds,
    requiresMatchReconcile: enablesMissingMediaPolicy(
      existing.downloadWhenMediaMissing,
      body.downloadWhenMediaMissing,
      globalDownloadWhenMissing,
    )
      ? true
      : undefined,
  })

  const changedKeys = Object.entries({
    name: body.name,
    enabled: body.enabled,
    plexPlaylistName: body.plexPlaylistName,
    plexPlaylistRatingKey: body.plexPlaylistRatingKey,
    syncLimit: body.syncLimit,
    autoCreatePlexPlaylist: body.autoCreatePlexPlaylist,
    forceFullCompare: body.forceFullCompare,
    downloadWhenMediaMissing: body.downloadWhenMediaMissing,
    fullCompareAfterSkips: body.fullCompareAfterSkips,
    fullCompareAfterDays: body.fullCompareAfterDays,
    skipPlexPlaylist: body.skipPlexPlaylist,
    skipRemoveExtraTracks: body.skipRemoveExtraTracks,
    neteasePlaylistName: body.neteasePlaylistName,
  }).filter(([, value]) => value !== undefined).map(([key]) => key)

  if (updated && changedKeys.length > 0) {
    const enabledChanged = body.enabled !== undefined && body.enabled !== existing.enabled
    recordActivityEvent({
      domain: 'user',
      type: enabledChanged ? (body.enabled ? 'source_enabled' : 'source_disabled') : 'source_updated',
      severity: enabledChanged && body.enabled === false ? 'warning' : 'info',
      actor: 'user',
      title: enabledChanged
        ? `${body.enabled ? '启用' : '停用'}同步源“${updated.neteasePlaylistName || updated.name}”`
        : `更新同步源“${updated.neteasePlaylistName || updated.name}”`,
      summary: enabledChanged
        ? (body.enabled ? '该同步源已重新加入自动同步。' : '该同步源已停止自动同步，但历史记录仍保留。')
        : `本次更新了 ${changedKeys.length} 项配置：${changedKeys.join('、')}`,
      context: { sourceId: updated.id, sourceName: updated.neteasePlaylistName || updated.name, changedKeys },
      link: '/sync-sources',
      groupKey: `source:${updated.id}`,
    })
  }

  return success(updated, '歌单源更新成功')
})
