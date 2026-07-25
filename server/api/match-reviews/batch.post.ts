import { fail, success } from '../../lib/response'
import { readConfigFromDb } from '../../lib/db'
import { recordActivityEvent } from '../../lib/activity/store'
import { getSectionKey, getTrackByRatingKey, initPlexClient } from '../../lib/plex-client'
import {
  decideMatchReviewsBatch,
  getMatchReview,
  type MatchReviewDecisionInput,
} from '../../lib/sync/identity-store'
import { buildAcceptedReviewBinding } from '../../lib/sync/review-decision'

const MAX_BATCH_SIZE = 100

export default defineEventHandler(async (event) => {
  const body = await readBody<unknown>(event)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('请求内容无效')
  const value = body as { ids?: unknown; decision?: unknown }
  if (value.decision !== 'accept' && value.decision !== 'reject') {
    return fail('decision 必须是 accept 或 reject')
  }
  if (!Array.isArray(value.ids)) return fail('ids 必须是审核记录 ID 数组')
  const ids = [...new Set(value.ids
    .filter((id): id is string => typeof id === 'string')
    .map(id => id.trim())
    .filter(Boolean))]
  if (ids.length === 0) return fail('请至少选择一条审核记录')
  if (ids.length > MAX_BATCH_SIZE) return fail(`单次最多处理 ${MAX_BATCH_SIZE} 条审核记录`)
  if (ids.length !== value.ids.length) return fail('审核记录 ID 包含空值、重复项或非字符串')

  const reviews = ids.map(id => getMatchReview(id))
  const missingId = ids.find((_, index) => !reviews[index])
  if (missingId) return fail(`审核记录不存在：${missingId}`)
  const resolvedReviews = reviews.filter((review): review is NonNullable<typeof review> => Boolean(review))
  const desiredFinalStatus = value.decision === 'accept' ? 'accepted' : 'rejected'
  const conflicting = resolvedReviews.find(review => review.status !== 'pending' && review.status !== desiredFinalStatus)
  if (conflicting) {
    return fail(`审核记录 #${conflicting.neteaseSongId} 已是“${conflicting.status}”状态，请刷新后重试`)
  }

  const pending = resolvedReviews.filter(review => review.status === 'pending')
  if (value.decision === 'accept') {
    const duplicateSong = pending.find((review, index) =>
      pending.findIndex(candidate => candidate.neteaseSongId === review.neteaseSongId) !== index,
    )
    if (duplicateSong) return fail(`歌曲 #${duplicateSong.neteaseSongId} 选中了多个候选，请只接受其中一个`)
    const missingCandidate = pending.find(review => !review.candidatePlexRatingKey)
    if (missingCandidate) return fail(`歌曲 #${missingCandidate.neteaseSongId} 没有可直接接受的 Plex 候选`)
  }

  try {
    let decisions: MatchReviewDecisionInput[]
    if (value.decision === 'reject') {
      decisions = pending.map(review => ({ id: review.id, decision: 'reject' }))
    } else {
      const cfg = readConfigFromDb()
      await initPlexClient(cfg.plex)
      const sectionKey = await getSectionKey(cfg.plex.section)
      if (!sectionKey) return fail('未找到 Plex 音乐库分区')
      const tracks = await Promise.all(pending.map(review => getTrackByRatingKey(review.candidatePlexRatingKey!)))
      decisions = pending.map((review, index) => ({
        id: review.id,
        decision: 'accept',
        binding: buildAcceptedReviewBinding({
          review,
          track: tracks[index] ?? null,
          sectionKey,
          sectionRoot: cfg.download.plexLibraryPathPrefix,
        }),
      }))
    }

    const decided = decideMatchReviewsBatch(decisions)
    const unchanged = resolvedReviews.length - pending.length
    recordActivityEvent({
      domain: 'user',
      type: value.decision === 'accept' ? 'match_reviews_batch_accepted' : 'match_reviews_batch_rejected',
      severity: value.decision === 'accept' ? 'success' : 'info',
      actor: 'user',
      title: value.decision === 'accept' ? '批量接受匹配候选' : '批量拒绝匹配候选',
      summary: `处理 ${decided.length} 条${unchanged > 0 ? `，${unchanged} 条状态未变化` : ''}。`,
      context: { reviewIds: ids, processed: decided.length, unchanged, decision: value.decision },
      link: '/match-reviews',
      groupKey: `match-review-batch:${Date.now()}`,
    })
    return success({
      decision: value.decision,
      requested: ids.length,
      processed: decided.length,
      unchanged,
      items: decided,
    }, value.decision === 'accept'
      ? `已建立 ${decided.length} 个全局歌曲绑定`
      : `已拒绝 ${decided.length} 个候选`)
  } catch (error) {
    return fail(error instanceof Error ? `批量审核未修改任何记录：${error.message}` : '批量审核失败')
  }
})
