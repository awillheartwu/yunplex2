import { success, fail } from '../../../../lib/response'
import { getDownloadTask, processAll } from '../../../../lib/download/queue'
import { getSyncServiceInstance } from '../../../../lib/sync/instance'
import { readConfig } from '../../../../lib/config/store'
import { downloadSingleSong } from '../../../../lib/download/single-song'
import { appendLog } from '../../../../lib/log/store'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) return fail('缺少任务 ID')

  const task = getDownloadTask(id)
  if (!task) return fail('下载任务不存在')
  if (task.status !== 'failed') return fail('只能重试失败的任务')

  const syncService = getSyncServiceInstance()
  if (syncService.getState().isRunning) return fail('已有同步任务在运行中，请等待完成')

  const dataDir = useRuntimeConfig(event).dataDir
  const cfg = readConfig()
  const retentionDays = cfg.sync.logRetentionDays ?? 30

  // Log retry start
  appendLog(dataDir, {
    level: 'info',
    message: `[重试] 开始下载: ${task.songName} - ${task.artist}`,
    stage: 'download',
  }, retentionDays)

  const processor = async (
    t: typeof task,
    onProgress: (pct: number, phase?: 'downloading' | 'tagging') => void,
    signal: AbortSignal,
  ) => {
    return downloadSingleSong(t.songId, {
      quality: t.quality || cfg.netease.quality,
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
    }, onProgress, signal)
  }

  processAll(async (t, onProgress, signal) => {
    try {
      const result = await processor(t, onProgress, signal)
      appendLog(dataDir, {
        level: 'info',
        message: `[重试] 下载成功: ${t.songName} - ${t.artist} → ${result.filePath}`,
        stage: 'download',
      }, retentionDays)
      return result
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '下载失败'
      appendLog(dataDir, {
        level: 'error',
        message: `[重试] 下载失败: ${t.songName} - ${t.artist}`,
        detail: msg,
        stage: 'download',
      }, retentionDays)
      throw err
    }
  }, undefined, 1, [id]).catch(() => { /* processAll records task failure and emits queue events */ })

  return success({ retried: true }, '重试已启动')
})
