import { success, fail } from '../../../lib/response'
import { getSyncServiceInstance } from '../../../lib/sync/instance'
import { processAll } from '../../../lib/download/queue'
import { readConfig } from '../../../lib/config/store'
import { downloadSingleSong } from '../../../lib/download/single-song'
import { resolveSingleSongConfig } from '../../../lib/download/options'
import { appendLog } from '../../../lib/log/store'
import { getFailureRecords, incrementFailureRetries, setFailureRecordStatus } from '../../../lib/tasks/failure-records'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ ids: string[] }>(event)

  if (!body?.ids || body.ids.length === 0) {
    return fail('请提供要重试的失败项 ID 列表')
  }

  const syncService = getSyncServiceInstance()
  if (syncService.getState().isRunning) {
    return fail('已有同步任务在运行中，请等待完成')
  }

  const dataDir = useRuntimeConfig(event).dataDir
  const cfg = readConfig()
  const retentionDays = cfg.sync.logRetentionDays ?? 30

  const records = getFailureRecords(body.ids)
  const taskIds = [...new Set(records.flatMap(record => record.downloadTaskIds))]
  if (taskIds.length === 0) {
    return success({ count: 0 }, '这些问题需要从对应运行或同步源重新执行')
  }

  incrementFailureRetries(body.ids)
  setFailureRecordStatus(body.ids, 'open')

  appendLog(dataDir, {
    level: 'info',
    message: `[批量重试] ${taskIds.length} 个失败项开始重试`,
    stage: 'download',
  }, retentionDays)

  // Build processor
  const processor = async (
    t: { songId: number; songName: string; artist: string; quality?: string | null },
    onProgress: (pct: number, phase?: 'downloading' | 'tagging') => void,
    signal: AbortSignal,
  ) => {
    return downloadSingleSong(t.songId, resolveSingleSongConfig(cfg, {
      quality: (t.quality || cfg.netease.quality) as string,
      downloadMode: 'full',
    }), onProgress, signal)
  }

  processAll(async (t, onProgress, signal) => {
    try {
      const r = await processor(t, onProgress, signal)
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
  }, undefined, cfg.sync.downloadConcurrency || 3, taskIds).catch(() => { /* errors reported via SSE */ })

  return success({ count: taskIds.length }, `${taskIds.length} 个失败项已开始下载`)
})
