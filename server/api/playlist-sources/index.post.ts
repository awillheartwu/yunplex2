import { success, fail } from '../../lib/response'
import { listSources, createSource } from '../../lib/playlist/store'
import { readConfig } from '../../lib/config/store'
import { getSyncServiceInstance, isRepairRunning } from '../../lib/sync/instance'
import { recordActivityEvent } from '../../lib/activity/store'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    neteasePlaylistId: number
    type?: 'playlist' | 'album'
    subscribed?: boolean
    trackCount?: number
    name?: string
    artist?: string
    coverUrl?: string
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
      coverUrl: body.coverUrl,
    })
    let autoSyncRunId: string | null = null
    // Auto-sync album if enabled
    if (body.type === 'album' && cfg.sync.autoDownloadAlbum) {
      const syncService = getSyncServiceInstance()
      const state = syncService.getState()
      if (!state.isRunning && !isRepairRunning()) {
        autoSyncRunId = syncService.startSyncForSource(source.id, { mode: 'full', trigger: 'system' }).runId
      }
    }
    recordActivityEvent({
      domain: 'user',
      type: body.type === 'album' ? 'source_created_album' : 'source_created_playlist',
      severity: 'info',
      actor: 'user',
      title: `新增${body.type === 'album' ? '专辑' : '同步源'}“${source.neteasePlaylistName || source.name}”`,
      summary: body.type === 'album'
        ? `已加入专辑源，后续可从运行记录追踪自动补全与同步。`
        : `已加入同步列表，后续可继续配置 Plex 歌单与同步策略。`,
      context: { sourceId: source.id, sourceName: source.neteasePlaylistName || source.name, type: source.type, ...(autoSyncRunId ? { jobId: autoSyncRunId } : {}) },
      link: autoSyncRunId ? `/task-center/runs/${autoSyncRunId}` : '/sync-sources',
      groupKey: `source:${source.id}`,
    })
    return success({ ...source, ...(autoSyncRunId ? { runId: autoSyncRunId } : {}) }, body.type === 'album' ? '专辑源添加成功' : '歌单源添加成功')
  } catch (err) {
    const msg = err instanceof Error ? err.message : '创建失败'
    return fail(msg)
  }
})
