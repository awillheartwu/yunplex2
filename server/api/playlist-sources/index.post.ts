import { success, fail } from '../../lib/response'
import { listSources, createSource } from '../../lib/playlist/store'
import { readConfig } from '../../lib/config/store'
import { getSyncServiceInstance } from '../../lib/sync/instance'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    neteasePlaylistId: number
    type?: 'playlist' | 'album'
    subscribed?: boolean
    trackCount?: number
    name?: string
    artist?: string
  }>(event)
  if (!body?.neteasePlaylistId || typeof body.neteasePlaylistId !== 'number') {
    return fail('请提供有效的 ID')
  }

  const existing = listSources()
  if (existing.some(s => s.neteasePlaylistId === body.neteasePlaylistId && s.type === (body.type || 'playlist'))) {
    return fail(body.type === 'album' ? '该专辑 ID 已存在' : '该歌单 ID 已存在')
  }

  try {
    const cfg = readConfig()
    const source = await createSource(body.neteasePlaylistId, cfg.netease.cookie, {
      type: body.type || 'playlist',
      subscribed: body.subscribed,
      trackCount: body.trackCount,
      name: body.name,
      artist: body.artist,
    })
    // Auto-sync album if enabled
    if (body.type === 'album' && cfg.sync.autoDownloadAlbum) {
      const syncService = getSyncServiceInstance()
      const state = syncService.getState()
      if (!state.isRunning) {
        syncService.runSyncForSource(source.id, { forceFull: true }).catch((err: unknown) => {
          console.error('[YunPlex2] auto album sync failed:', err instanceof Error ? err.message : String(err))
        })
      }
    }
    return success(source, body.type === 'album' ? '专辑源添加成功' : '歌单源添加成功')
  } catch (err) {
    const msg = err instanceof Error ? err.message : '创建失败'
    return fail(msg)
  }
})
