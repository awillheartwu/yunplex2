import { success, fail } from '../../../../lib/response'
import { getDownloadTask, processAll } from '../../../../lib/download/queue'
import { getSyncServiceInstance } from '../../../../lib/sync/instance'
import { readConfig } from '../../../../lib/config/store'
import { downloadSingleSong } from '../../../../lib/download/single-song'
import { resolveSingleSongConfig } from '../../../../lib/download/options'
import { appendLog } from '../../../../lib/log/store'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) return fail('缺少任务 ID')

  const task = getDownloadTask(id)
  if (!task) return fail('下载任务不存在')
  if (task.status !== 'failed') return fail('只能重试失败的任务')

  const syncService = getSyncServiceInstance()
  if (syncService.getState().isRunning) return fail('已有同步任务在运行中，请等待完成')

  const cfg = readConfig()

  const processor = async (
    t: typeof task,
    onProgress: (pct: number, phase?: 'downloading' | 'tagging') => void,
    signal: AbortSignal,
  ) => {
    return downloadSingleSong(t.songId, resolveSingleSongConfig(cfg, {
      quality: t.quality || cfg.netease.quality,
      downloadMode: 'full',
    }), onProgress, signal)
  }

  processAll(async (t, onProgress, signal) => {
    try {
      const result = await processor(t, onProgress, signal)
      return result
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '下载失败'
      appendLog({
        level: 'error',
        message: `[重试] 下载失败: ${t.songName} - ${t.artist}`,
        detail: msg,
        stage: 'download',
      })
      throw err
    }
  }, undefined, 1, [id]).catch(() => { /* processAll records task failure and emits queue events */ })

  return success({ retried: true }, '重试已启动')
})
