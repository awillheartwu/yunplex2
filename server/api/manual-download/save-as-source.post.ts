import { success, fail } from '../../lib/response'
import { readConfig } from '../../lib/config/store'
import { getSyncWorker } from '../../lib/sync/instance'
import { startSourceAttributedResourceDownload } from '../../lib/download/save-source-download-command'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    neteaseId: number
    type: 'playlist' | 'album'
    selectedSongIds: number[]
    name?: string
    trackCount?: number
    coverUrl?: string
    quality?: string
    downloadLyrics?: boolean
    downloadImages?: boolean
    embedMetadata?: boolean
  }>(event)

  if (!body || !Number.isSafeInteger(body.neteaseId) || body.neteaseId <= 0) {
    return fail('缺少 neteaseId')
  }
  if (!['playlist', 'album'].includes(body.type)) return fail('type 必须为 playlist 或 album')
  if (!Array.isArray(body.selectedSongIds) || body.selectedSongIds.length === 0) {
    return fail('请至少选择一首歌曲')
  }

  const cfg = readConfig()
  if (!cfg.netease.cookie) return fail('请先在设置中配置网易云 Cookie')

  try {
    const result = await startSourceAttributedResourceDownload({
      type: body.type,
      neteaseId: body.neteaseId,
      selectedSongIds: body.selectedSongIds,
      name: body.name,
      trackCount: body.trackCount,
      coverUrl: body.coverUrl,
      quality: body.quality,
      downloadLyrics: body.downloadLyrics,
      embedMetadata: body.embedMetadata,
      embedCover: body.downloadImages,
      config: cfg,
    })
    getSyncWorker()?.update()
    return success(result, `已创建禁用的同步源，并加入 ${result.total} 首托管下载`)
  } catch (error) {
    return fail(error instanceof Error ? error.message : '创建来源并下载失败')
  }
})
