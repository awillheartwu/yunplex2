import { success, fail } from '../../../lib/response'
import { getSyncServiceInstance } from '../../../lib/sync/instance'
import { getDb } from '../../../lib/db'
import { readConfig } from '../../../lib/config/store'
import { processAll } from '../../../lib/download/queue'
import { downloadSingleSong } from '../../../lib/download/single-song'
import { appendLog } from '../../../lib/log/store'

export default defineEventHandler(async () => {
  const syncService = getSyncServiceInstance()
  if (syncService.getState().isRunning) return fail('已有同步任务在运行中，请等待完成')

  const db = getDb()
  const cfg = readConfig()
  const dataDir = (useRuntimeConfig() as { dataDir: string }).dataDir
  const retentionDays = cfg.sync.logRetentionDays ?? 30
  const rows = db.prepare("SELECT id FROM download_tasks WHERE status = 'failed' ORDER BY updated_at ASC").all() as Array<{ id: string }>
  const taskIds = rows.map(row => row.id)
  if (taskIds.length === 0) return success({ count: 0 }, '没有失败任务需要重试')

  appendLog(dataDir, {
    level: 'info',
    message: `[批量重试] ${taskIds.length} 个失败下载任务开始重试`,
    stage: 'download',
  }, retentionDays)

  processAll((task, onProgress, signal) => downloadSingleSong(task.songId, {
    quality: task.quality || cfg.netease.quality,
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
  }, onProgress, signal), undefined, cfg.sync.downloadConcurrency || 3, taskIds).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    appendLog(dataDir, {
      level: 'error',
      message: '[批量重试] 失败任务处理异常',
      detail: msg,
      stage: 'download',
    }, retentionDays)
  })

  return success({ count: taskIds.length }, `${taskIds.length} 个失败任务已开始下载`)
})
