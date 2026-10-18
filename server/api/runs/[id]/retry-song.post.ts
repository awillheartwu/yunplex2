import { success, fail } from '../../../lib/response'
import { getSyncRun } from '../../../lib/run/store'
import { retryTargets } from '../../../lib/tasks/retry'
import { canRetrySong } from '../../../../shared/failure-handling'
export default defineEventHandler(async (event) => {
  const runId = getRouterParam(event, 'id')
  if (!runId) return fail('缺少运行 ID')

  const body = await readBody<{ songId: string }>(event)
  const { songId } = body || {}
  if (!songId) return fail('缺少歌曲 ID')

  const run = getSyncRun(runId)
  if (!run) return fail('运行记录不存在')

  const song = run.songs.find(candidate => candidate.id === songId)
  if (!song) return fail('歌曲不存在')
  if (!canRetrySong(song.status)) return fail('只有失败或暂停的歌曲可以重试')
  if (!song.neteaseSongId) return fail('此歌曲缺少网易云歌曲 ID，无法直接重试')
  if (!song.sourceId) return fail('该歌曲缺少歌单源信息')

  try {
    const result = retryTargets([{
      sourceId: song.sourceId,
      songId: song.neteaseSongId,
    }])
    return success(result, '已提交歌曲重新处理')
  } catch (error) {
    return fail(error, 1, 'validation_failed')
  }
})
