import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../..', import.meta.url))
const page = readFileSync(`${root}/pages/match-reviews.vue`, 'utf8')
const queue = readFileSync(`${root}/components/match-management/ReviewQueueTab.vue`, 'utf8')
const overview = readFileSync(`${root}/components/match-management/OverviewTab.vue`, 'utf8')
const history = readFileSync(`${root}/components/match-management/IdentityHistoryTab.vue`, 'utf8')
const routeState = readFileSync(`${root}/composables/useMatchManagementRouteState.ts`, 'utf8')
const batchRoute = readFileSync(`${root}/server/api/match-reviews/batch.post.ts`, 'utf8')

describe('match review page contract', () => {
  it('splits match management into URL-addressable review, overview and history tabs', () => {
    expect(routeState).toContain("type MatchManagementTab = 'reviews' | 'overview' | 'history'")
    expect(page).toContain('<ReviewQueueTab')
    expect(page).toContain('<OverviewTab')
    expect(page).toContain('<IdentityHistoryTab')
    expect(page).toContain('useMatchManagementRouteState()')
    expect(routeState).toContain('route.query.tab')
    expect(overview).toContain("'/match-management/overview'")
    expect(history).toContain("'/match-management/events'")
  })

  it('gives every KeepAlive tab a type-stable cache key', () => {
    expect(page).toContain(':key="`reviews:${refreshKey}`"')
    expect(page).toContain(':key="`overview:${refreshKey}`"')
    expect(page).toContain(':key="`history:${refreshKey}`"')
    expect(page).not.toContain(':key="refreshKey"')
  })

  it('uses server aggregates and paged results instead of counting the first client-side batch', () => {
    expect(queue).toContain("api.get<MatchReviewPage>('/match-reviews'")
    expect(queue).toContain('result.counts.pending')
    expect(queue).toContain('result.counts.accepted')
    expect(queue).toContain('result.counts.activeBindings')
    expect(queue).toContain('result.totalPages')
    expect(queue).not.toMatch(/items\.filter\([^)]*status/)
  })

  it('exposes source, evidence, status and page-size filters with accessible labels', () => {
    expect(queue).toContain('for="review-status"')
    expect(queue).toContain('for="review-source"')
    expect(queue).toContain('for="review-evidence"')
    expect(queue).toContain('for="review-page-size"')
    expect(page).toContain('弱证据候选仍受删除保护')
  })

  it('defaults review filtering to all sources without inheriting the overview source', () => {
    expect(queue).toContain("route.query.reviewSource")
    expect(queue).toContain("reviewSource: sourceId.value || undefined")
    expect(queue).not.toContain("const sourceId = ref(typeof route.query.source")
  })

  it('supports accessible cross-page batch accept and reject with confirmation', () => {
    expect(queue).toContain('选择本页待审核项')
    expect(queue).toContain('选择会在翻页时保留')
    expect(queue).toContain('批量接受')
    expect(queue).toContain('批量拒绝')
    expect(queue).toContain("api.post<BatchDecisionResult>('/match-reviews/batch'")
    expect(queue).toContain(':indeterminate.prop="someCurrentPageSelected"')
    expect(queue).toContain('<ConfirmDialog')
  })

  it('keeps overview identity mutation single-song and bulk operations validation-only', () => {
    expect(overview).toContain('立即验证整个歌单')
    expect(overview).toContain('验证所选')
    expect(overview).toContain('搜索并重绑')
    expect(overview).toContain('item.target.title')
    expect(overview).toContain('重新匹配')
    expect(overview).toContain('来自历史审核证据')
    expect(overview).toContain('解绑并重新评估')
    expect(overview).toContain('排除此文件')
    expect(overview).toContain('validateStaleBindingsInBackground')
    expect(overview).toContain('前往同步源')
    expect(overview).not.toContain('批量重绑')
    expect(overview).not.toContain('批量解绑')
  })

  it('reuses the shared date range picker for inclusive history filtering', () => {
    expect(history).toContain('<FilterDateRange')
    expect(history).toContain('结束日期包含当天全部事件')
    expect(history).toContain('T23:59:59.999')
    expect(history).not.toContain('type="datetime-local"')
  })

  it('uses a bounded atomic backend batch instead of looping single-record APIs', () => {
    expect(batchRoute).toContain('MAX_BATCH_SIZE = 100')
    expect(batchRoute).toContain('decideMatchReviewsBatch(decisions)')
    expect(batchRoute).toContain('批量审核未修改任何记录')
    expect(batchRoute).not.toContain('/decision')
  })
})
