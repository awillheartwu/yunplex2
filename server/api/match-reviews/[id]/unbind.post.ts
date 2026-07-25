import { fail, success } from '../../../lib/response'
import { getMatchReview, unbindSongIdentity } from '../../../lib/sync/identity-store'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  if (!id) return fail('缺少审核记录 ID')
  const review = getMatchReview(id)
  if (!review) return fail('审核记录不存在')
  try {
    unbindSongIdentity(review.neteaseSongId, review.sourceId, review.runId)
    return success({ neteaseSongId: review.neteaseSongId }, '已解除全局绑定')
  } catch (error) {
    return fail(error instanceof Error ? error.message : '解除全局绑定失败')
  }
})
