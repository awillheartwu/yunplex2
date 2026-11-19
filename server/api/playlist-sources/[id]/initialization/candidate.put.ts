import { initializationFailure } from '../../../../lib/source-initialization/errors'
import { fail, success } from '../../../../lib/response'
import { getTrackByRatingKey, initPlexClient } from '../../../../lib/plex-client'
import { readConfigFromDb } from '../../../../lib/db'
import { getLatestInitialization, setInitializationCandidate } from '../../../../lib/source-initialization/store'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') || ''; const initialization = getLatestInitialization(id)
  if (!initialization || initialization.status !== 'awaiting_review') return fail('当前没有等待确认的接管方案')
  const body = await readBody<{ initializationId?: string; songId?: number; ratingKey?: string }>(event)
  if (body.initializationId !== initialization.id) return fail('接管方案已变化，请刷新后重新操作', 409, 'validation_failed')
  if (!Number.isSafeInteger(body.songId) || !body.ratingKey) return fail('请选择有效的歌曲和 Plex 媒体')
  await initPlexClient(readConfigFromDb().plex); const track = await getTrackByRatingKey(body.ratingKey)
  const filePath = track?.Media?.flatMap(media => media.Part?.flatMap(part => part.file ? [part.file] : []) ?? [])[0]
  if (!track || !filePath) return fail('Plex 媒体已不存在或没有路径')
  try {
    setInitializationCandidate({ initializationId: initialization.id, songId: body.songId!, candidate: { ratingKey: track.ratingKey, filePath, title: track.title, artist: track.grandparentTitle || '', album: track.parentTitle || '', durationMs: track.duration ?? null } })
    return success(null, '已选择 Plex 媒体')
  } catch (error) {
    return initializationFailure(error)
  }
})
