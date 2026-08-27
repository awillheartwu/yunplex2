import { startManagedSongDownload } from '../../../../../lib/download/managed-media-command'
import { fail, success } from '../../../../../lib/response'

export default defineEventHandler(async (event) => {
  const sourceId = getRouterParam(event, 'id')
  const songId = Number(getRouterParam(event, 'songId'))
  if (!sourceId) return fail('缺少同步源 ID')
  if (!Number.isSafeInteger(songId) || songId <= 0) return fail('歌曲 ID 无效')

  try {
    const result = await startManagedSongDownload({ sourceId, neteaseSongId: songId })
    return success({ batchId: result.batchId, total: result.total }, '已加入托管下载队列')
  } catch (error) {
    return fail(error instanceof Error ? error.message : '启动托管下载失败')
  }
})
