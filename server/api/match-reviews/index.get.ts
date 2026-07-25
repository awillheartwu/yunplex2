import { fail, success } from '../../lib/response'
import {
  isReviewEvidenceType,
  isReviewStatus,
  queryMatchReviews,
} from '../../lib/sync/identity-store'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const rawStatus = typeof query.status === 'string' && query.status ? query.status : undefined
  if (rawStatus && !isReviewStatus(rawStatus)) return fail('无效的审核状态筛选')
  const status = rawStatus && isReviewStatus(rawStatus) ? rawStatus : undefined
  const rawEvidenceType = typeof query.evidenceType === 'string' && query.evidenceType ? query.evidenceType : undefined
  if (rawEvidenceType && !isReviewEvidenceType(rawEvidenceType)) return fail('无效的证据类型筛选')
  const evidenceType = rawEvidenceType && isReviewEvidenceType(rawEvidenceType) ? rawEvidenceType : undefined
  const sourceId = typeof query.sourceId === 'string' && query.sourceId ? query.sourceId : undefined
  const rawPage = Number(query.page)
  const rawPageSize = Number(query.pageSize)
  return success(queryMatchReviews({
    status,
    sourceId,
    evidenceType,
    page: Number.isFinite(rawPage) ? rawPage : 1,
    pageSize: Number.isFinite(rawPageSize) ? rawPageSize : 25,
  }))
})
