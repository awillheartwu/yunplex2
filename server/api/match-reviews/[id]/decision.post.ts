import { fail, success } from '../../../lib/response'
import { readConfigFromDb } from '../../../lib/db'
import { initPlexClient, getSectionKey, getTrackByRatingKey } from '../../../lib/plex-client'
import { decideMatchReview, getMatchReview } from '../../../lib/sync/identity-store'
import { buildAcceptedReviewBinding } from '../../../lib/sync/review-decision'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) return fail('缺少审核记录 ID')
  const review = getMatchReview(id)
  if (!review) return fail('审核记录不存在')
  const body = await readBody<{ decision?: 'accept' | 'reject'; ratingKey?: string }>(event)
  if (body.decision !== 'accept' && body.decision !== 'reject') return fail('decision 必须是 accept 或 reject')
  if (body.decision === 'reject') {
    try {
      return success(decideMatchReview(id, 'reject'), '已拒绝候选，后续同步不会再次推送同一候选')
    } catch (error) {
      return fail(error instanceof Error ? error.message : '拒绝候选失败')
    }
  }

  const ratingKey = body.ratingKey || review.candidatePlexRatingKey
  if (!ratingKey) return fail('接受匹配需要选择 Plex 曲目')
  const cfg = readConfigFromDb()
  await initPlexClient(cfg.plex)
  const [track, sectionKey] = await Promise.all([getTrackByRatingKey(ratingKey), getSectionKey(cfg.plex.section)])
  try {
    const binding = buildAcceptedReviewBinding({
      review,
      track,
      sectionKey,
      sectionRoot: cfg.download.plexLibraryPathPrefix,
    })
    const result = decideMatchReview(id, 'accept', binding)
    return success(result, '已建立全局歌曲绑定')
  } catch (error) {
    return fail(error instanceof Error ? error.message : '建立全局歌曲绑定失败')
  }
})
