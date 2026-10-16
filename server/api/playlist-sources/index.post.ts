import { requestSources, type SourceRequestsResult } from '../../lib/sync/source-requests'
import { success, fail } from '../../lib/response'
import { listSources, createSource } from '../../lib/playlist/store'
import { readConfig } from '../../lib/config/store'
import { getSyncWorker } from '../../lib/sync/instance'
import { getDb } from '../../lib/db'
import { requestSourceInitialization } from '../../lib/source-initialization/requests'
import type { PlaylistStartMode } from '../../../shared/source-onboarding'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    neteasePlaylistId: number
    type?: 'playlist' | 'album'
    subscribed?: boolean
    trackCount?: number
    name?: string
    artist?: string
    coverUrl?: string
    startMode?: PlaylistStartMode
    enabled?: boolean
  }>(event)
  if (!Number.isSafeInteger(body?.neteasePlaylistId) || body.neteasePlaylistId <= 0) {
    return fail('请提供有效的 ID')
  }
  if (body.startMode !== undefined && !['automatic', 'review'].includes(body.startMode)) return fail('请选择有效的开始方式')
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') return fail('自动同步开关无效')

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
      enabled: body.enabled,
    })
    if (source.type === 'playlist' && body.startMode) {
      getDb().transaction(() => {
        getDb().prepare('UPDATE source_initializations SET auto_process=? WHERE source_id=? AND status=\'pending\'')
          .run(Number(body.startMode === 'automatic'), source.id)
        requestSourceInitialization(source.id, 'user')
      })()
    }
    let autoSync: SourceRequestsResult | undefined
    if (body.type === 'album' && cfg.sync.autoDownloadAlbum) {
      autoSync = requestSources({ sourceIds: [source.id], mode: 'full', trigger: 'system' })
    }
    getSyncWorker()?.update()
    return success({ ...source, ...(autoSync ? { sourceRequests: autoSync } : {}) }, body.type === 'album' ? '专辑源添加成功' : '歌单源添加成功')
  } catch (err) {
    const msg = err instanceof Error ? err.message : '创建失败'
    return fail(msg)
  }
})
