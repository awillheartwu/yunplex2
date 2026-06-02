import { success, fail } from '../../../lib/response'
import { getSyncServiceInstance } from '../../../lib/sync/instance'
import { getDb } from '../../../lib/db'
import { processAll } from '../../../lib/download/queue'
import { readConfig } from '../../../lib/config/store'
import { downloadSingleSong } from '../../../lib/download/single-song'
import { appendLog } from '../../../lib/log/store'
import { resolveCompositeIds } from '../../../lib/tasks/failure-store'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ ids: string[] }>(event)

  if (!body?.ids || body.ids.length === 0) {
    return fail('请提供要重试的失败项 ID 列表')
  }

  const syncService = getSyncServiceInstance()
  if (syncService.getState().isRunning) {
    return fail('已有同步任务在运行中，请等待完成')
  }

  const db = getDb()
  const now = new Date().toISOString()
  const dataDir = useRuntimeConfig(event).dataDir
  const cfg = readConfig()
  const retentionDays = cfg.sync.logRetentionDays ?? 30

  const taskIds = resolveCompositeIds(body.ids)
  if (taskIds.length === 0) {
    return success({ count: 0 }, '没有找到可重试的下载任务（同步失败项需通过同步源页面重试）')
  }

  // Reset to pending
  const idPlaceholders = taskIds.map(() => '?').join(',')
  const result = db.prepare(
    `UPDATE download_tasks SET status = 'pending', error = NULL, progress = 0, updated_at = ? WHERE id IN (${idPlaceholders}) AND status = 'failed'`,
  ).run(now, ...taskIds)

  appendLog(dataDir, {
    level: 'info',
    message: `[批量重试] ${result.changes} 个失败项重新加入队列`,
    stage: 'download',
  }, retentionDays)

  // Build processor
  const processor = async (t: { songId: number; songName: string; artist: string; quality?: string | null }, onProgress: (pct: number) => void) => {
    return downloadSingleSong(t.songId, {
      quality: (t.quality || cfg.netease.quality) as string,
      cookie: cfg.netease.cookie,
      downloadDir: cfg.download.dir,
      pathFormat: cfg.other?.pathFormat ?? '{artist}/{album} ({year})/{title}',
      multiArtistFormat: cfg.other?.multiArtistFormat ?? 'ampersand',
      downloadLyrics: cfg.download.downloadLyrics,
      embedMetadata: cfg.download.embedMetadata,
      embedCover: cfg.download.embedCover,
      saveAlbumCover: cfg.download.saveAlbumCover ?? false,
      saveArtistImage: cfg.download.saveArtistImage ?? false,
      lyricOrder: (cfg.other?.lyricOrder ?? 'original_first') as 'original_first' | 'translated_first',
      downloadTranslatedLyric: cfg.other?.downloadTranslatedLyric ?? true,
      downloadRomajiLyric: cfg.other?.downloadRomajiLyric ?? false,
      downloadMode: 'full',
    }, onProgress)
  }

  processAll(async (t, onProgress) => {
    try {
      const r = await processor(t, onProgress)
      appendLog(dataDir, {
        level: 'info',
        message: `[批量重试] 下载成功: ${t.songName} - ${t.artist} → ${r.filePath}`,
        stage: 'download',
      }, retentionDays)
      return r
    } catch (err) {
      const msg = err instanceof Error ? err.message : '下载失败'
      appendLog(dataDir, {
        level: 'error',
        message: `[批量重试] 下载失败: ${t.songName} - ${t.artist}`,
        detail: msg,
        stage: 'download',
      }, retentionDays)
      throw err
    }
  }).catch(() => { /* errors reported via SSE */ })

  return success({ count: result.changes }, `${result.changes} 个失败项已重新加入队列并开始下载`)
})
