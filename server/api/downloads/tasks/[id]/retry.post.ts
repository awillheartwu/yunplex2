import { success, fail } from '../../../../lib/response'
import { getDownloadTask, updateTaskState } from '../../../../lib/download/queue'
import { emitEvent } from '../../../../lib/sync/events'
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

  // Reset to pending
  updateTaskState(id, { status: 'pending', progress: 0, error: undefined })

  // Build processor with logging
  const processor = async (t: typeof task, onProgress: (pct: number) => void) => {
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
    }, onProgress)
  }

  // Process just this one task — don't use processAll to avoid picking up other pending tasks
  updateTaskState(id, { status: 'downloading', progress: 0 })
  emitEvent({
    type: 'queue-update',
    data: { taskId: id, songName: task.songName, status: 'downloading', progress: 0, sourceId: task.sourceId },
    timestamp: new Date().toISOString(),
  })

  // Fire-and-forget
  ;(async () => {
    try {
      const result = await processor(task, (pct, phase) => {
        updateTaskState(id, { progress: pct, status: phase || 'downloading' })
        emitEvent({
          type: 'queue-update',
          data: { taskId: id, songName: task.songName, status: phase || 'downloading', progress: pct, sourceId: task.sourceId },
          timestamp: new Date().toISOString(),
        })
      })

      // Tag-writing failures must not silently pass as "done"
      if (result.ops?.tags === 'failed') {
        throw new Error(`标签写入失败: ${task.songName}`)
      }

      updateTaskState(id, { status: 'done', progress: 100, filePath: result.filePath, fileType: result.fileType, error: undefined })
      emitEvent({
        type: 'queue-update',
        data: { taskId: id, songName: task.songName, status: 'done', progress: 100, sourceId: task.sourceId },
        timestamp: new Date().toISOString(),
      })
      appendLog(dataDir, {
        level: 'info',
        message: `[重试] 下载成功: ${task.songName} - ${task.artist} → ${result.filePath}`,
        stage: 'download',
      }, retentionDays)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '下载失败'
      updateTaskState(id, { status: 'failed', error: msg, progress: 0 })
      emitEvent({
        type: 'queue-update',
        data: { taskId: id, songName: task.songName, status: 'failed', error: msg, sourceId: task.sourceId },
        timestamp: new Date().toISOString(),
      })
      appendLog(dataDir, {
        level: 'error',
        message: `[重试] 下载失败: ${task.songName} - ${task.artist}`,
        detail: msg,
        stage: 'download',
      }, retentionDays)
    }
  })()

  return success({ retried: true }, '重试已启动')
})
