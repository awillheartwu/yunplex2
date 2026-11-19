import { startManagedSongDownloads } from '../../../../lib/download/managed-media-command'
import { fail, failDomain, success } from '../../../../lib/response'

export default defineEventHandler(async (event) => {
  const sourceId = getRouterParam(event, 'id')
  const body = await readBody<{ songIds?: number[] }>(event)
  if (!sourceId) return failDomain('validation_failed', '缺少同步源 ID')
  if (!Array.isArray(body?.songIds) || !body.songIds.length || body.songIds.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    return failDomain('validation_failed', '请选择有效的歌曲')
  }

  try {
    return success(await startManagedSongDownloads(sourceId, body.songIds))
  } catch (error) {
    return fail(error, 1, 'failed_download')
  }
})
