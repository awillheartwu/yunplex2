<template>
  <section class="match-reviews-page space-y-6" :aria-busy="loading">

    <section class="section-card review-summary" aria-label="审核摘要" aria-live="polite">
      <div><span>待审核</span><strong>{{ result.counts.pending }}</strong></div>
      <div><span>已接受</span><strong>{{ result.counts.accepted }}</strong></div>
      <div><span>全局绑定</span><strong>{{ result.counts.activeBindings }}</strong></div>
      <p>当前筛选 {{ result.total }} 条</p>
    </section>

    <section class="section-card review-toolbar" aria-label="审核筛选">
      <label class="review-filter" for="review-status">
        <span>状态</span>
        <select id="review-status" v-model="status" class="form-input" @change="applyFilters">
          <option value="pending">待审核</option>
          <option value="">全部历史</option>
          <option value="accepted">已接受</option>
          <option value="rejected">已拒绝</option>
          <option value="unbound">已解绑</option>
          <option value="superseded">已替代</option>
        </select>
      </label>
      <label class="review-filter" for="review-source">
        <span>歌单来源</span>
        <select id="review-source" v-model="sourceId" class="form-input" @change="applyFilters">
          <option value="">全部来源</option>
          <option v-for="source in result.facets.sources" :key="source.sourceId" :value="source.sourceId">
            {{ source.name }}（{{ source.count }}）
          </option>
        </select>
      </label>
      <label class="review-filter" for="review-evidence">
        <span>证据类型</span>
        <select id="review-evidence" v-model="evidenceType" class="form-input" @change="applyFilters">
          <option value="">全部证据</option>
          <option v-for="facet in result.facets.evidenceTypes" :key="facet.evidenceType" :value="facet.evidenceType">
            {{ evidenceTypeLabel(facet.evidenceType) }}（{{ facet.count }}）
          </option>
        </select>
      </label>
      <label class="review-filter review-filter--size" for="review-page-size">
        <span>每页</span>
        <select id="review-page-size" v-model.number="pageSize" class="form-input" @change="applyFilters">
          <option :value="25">25 条</option>
          <option :value="50">50 条</option>
          <option :value="100">100 条</option>
        </select>
      </label>
    </section>

    <section
      v-if="result.items.some(review => review.status === 'pending') || selectedCount > 0"
      class="section-card review-bulk-toolbar"
      aria-label="批量审核操作"
    >
      <label class="review-bulk-select">
        <input
          type="checkbox"
          :checked="allCurrentPageSelected"
          :indeterminate.prop="someCurrentPageSelected"
          :disabled="bulkActing || selectableReviews.length === 0"
          @change="toggleCurrentPage"
        >
        <span>选择本页待审核项</span>
        <small>{{ selectedOnCurrentPage }} / {{ selectableReviews.length }}</small>
      </label>
      <div class="review-bulk-summary" aria-live="polite">
        <strong>已选 {{ selectedCount }} 条</strong>
        <span v-if="hasOffPageSelection">其中 {{ selectedCount - selectedOnCurrentPage }} 条来自其他页</span>
        <span v-else>选择会在翻页时保留</span>
      </div>
      <div class="review-bulk-actions">
        <button
          class="btn btn-primary btn-sm"
          :disabled="selectedCount === 0 || !canBatchAccept || bulkActing"
          :title="batchAcceptDisabledReason"
          @click="requestBatch('accept')"
        >
          <AppIcon name="check" :size="14" />
          批量接受
        </button>
        <button
          class="btn btn-secondary btn-sm text-danger"
          :disabled="selectedCount === 0 || bulkActing"
          @click="requestBatch('reject')"
        >
          批量拒绝
        </button>
        <button class="btn btn-ghost btn-sm" :disabled="selectedCount === 0 || bulkActing" @click="clearSelection">
          清除选择
        </button>
      </div>
    </section>

    <div v-if="bulkNotice" class="section-card review-notice" role="status" aria-live="polite">
      <AppIcon name="check-circle" :size="16" />
      <span>{{ bulkNotice }}</span>
      <button class="btn btn-ghost btn-xs" aria-label="关闭批量操作提示" @click="bulkNotice = ''">关闭</button>
    </div>

    <div v-if="error" class="section-card review-error" role="alert">
      <span>{{ error }}</span>
      <button class="btn btn-ghost btn-sm" @click="load">重试</button>
    </div>
    <div v-else-if="loading && result.items.length === 0" class="section-card p-10 text-center text-muted" role="status">
      加载审核队列…
    </div>
    <EmptyState
      v-else-if="result.items.length === 0"
      title="没有符合条件的审核记录"
      description="强身份证据会自动建立绑定；后续同步遇到弱匹配、歧义或元数据漂移时，才会在这里生成候选。"
    />

    <section v-else class="space-y-3" aria-label="匹配审核记录">
      <article
        v-for="review in result.items"
        :key="review.id"
        class="section-card review-card"
        :class="{ 'review-card--selected': isSelected(review.id) }"
      >
        <header class="review-card__header">
          <div class="review-card__identity">
            <label v-if="review.status === 'pending'" class="review-card__select">
              <input
                type="checkbox"
                :checked="isSelected(review.id)"
                :disabled="bulkActing"
                :aria-label="`选择 ${desired(review).title || `网易云歌曲 ${review.neteaseSongId}`}`"
                @change="toggleReview(review)"
              >
            </label>
            <div class="min-w-0">
              <p class="review-card__eyebrow">
                网易云 #{{ review.neteaseSongId }}
                <template v-if="review.sourceId"> · {{ sourceName(review.sourceId) }}</template>
              </p>
              <h2>{{ desired(review).title || '历史记录缺少歌曲标题' }}</h2>
              <p class="text-2xs text-muted-deep">
                {{ desired(review).artists.join('、') || '未知艺人' }} · {{ desired(review).album || '未知专辑' }}
              </p>
            </div>
          </div>
          <span class="review-status" :class="`review-status--${review.status}`">{{ statusLabel(review.status) }}</span>
        </header>

        <div class="review-evidence">
          <div>
            <span>候选 Plex 曲目</span>
            <strong>{{ candidate(review).title || '未记录' }}</strong>
            <small>{{ candidate(review).artist || '未知艺人' }} · {{ candidate(review).album || '未知专辑' }}</small>
          </div>
          <div>
            <span>证据</span>
            <strong>{{ evidenceLabel(review) }}</strong>
            <small v-if="localMediaLabel(review)" class="review-media-origin">{{ localMediaLabel(review) }}</small>
            <small class="font-mono break-all">{{ review.candidatePlexFilePath || '无可用库内路径' }}</small>
          </div>
          <div>
            <span>当前全局绑定</span>
            <strong>{{ review.binding ? bindingLabel(review.binding) : '未建立' }}</strong>
            <small class="font-mono break-all">{{ review.binding?.plexRelativePath || review.binding?.plexFilePath || '待人工确认' }}</small>
          </div>
        </div>

        <p v-if="reason(review)" class="review-reason">{{ reason(review) }}</p>

        <footer v-if="review.status === 'pending' || review.binding?.status === 'active'" class="review-card__actions">
          <template v-if="review.status === 'pending'">
            <button
              class="btn btn-primary btn-sm"
              :disabled="actingId === review.id || bulkActing || !review.candidatePlexRatingKey"
              :aria-busy="actingId === review.id"
              @click="accept(review, review.candidatePlexRatingKey)"
            >
              {{ actingId === review.id ? '处理中…' : '接受此候选' }}
            </button>
            <button class="btn btn-secondary btn-sm" :disabled="actingId === review.id || bulkActing" @click="searchLibrary(review)">
              {{ searchingReviewId === review.id ? '关闭搜索' : '搜索 Plex 库' }}
            </button>
            <button class="btn btn-ghost btn-sm text-danger" :disabled="actingId === review.id || bulkActing" @click="reject(review)">
              拒绝候选
            </button>
          </template>
          <button
            v-if="review.binding?.status === 'active'"
            class="btn btn-ghost btn-sm"
            :disabled="actingId === review.id || bulkActing"
            @click="unbind(review)"
          >
            解除全局绑定
          </button>
        </footer>

        <div v-if="searchingReviewId === review.id" class="review-search" aria-live="polite">
          <p class="text-2xs text-muted-deep">{{ searching ? '正在搜索 Plex 库…' : '选择正确的 Plex 曲目' }}</p>
          <div v-for="track in searchResults" :key="track.ratingKey" class="review-search__track">
            <div class="min-w-0">
              <strong>{{ track.title }}</strong>
              <span>{{ track.artist || '未知艺人' }} · {{ track.album || '未知专辑' }}</span>
              <small class="font-mono">{{ track.plexFilePath || '无媒体路径' }}</small>
            </div>
            <button class="btn btn-secondary btn-xs" :disabled="actingId === review.id || !track.plexFilePath" @click="accept(review, track.ratingKey)">
              绑定此曲
            </button>
          </div>
          <p v-if="!searching && searchResults.length === 0" class="text-2xs text-muted-deep">未找到可绑定的 Plex 曲目。</p>
        </div>
      </article>
    </section>

    <nav v-if="result.totalPages > 1" class="section-card review-pagination" aria-label="审核记录分页">
      <button class="btn btn-secondary btn-sm" :disabled="loading || result.page <= 1" @click="goToPage(result.page - 1)">
        上一页
      </button>
      <span>第 {{ result.page }} / {{ result.totalPages }} 页 · {{ pageRangeLabel }}</span>
      <button class="btn btn-secondary btn-sm" :disabled="loading || result.page >= result.totalPages" @click="goToPage(result.page + 1)">
        下一页
      </button>
    </nav>

    <ConfirmDialog
      :visible="bulkDecision !== null"
      :title="bulkDecision === 'accept' ? '批量接受匹配候选' : '批量拒绝匹配候选'"
      :message="bulkConfirmationMessage"
      :confirm-label="bulkDecision === 'accept' ? `接受 ${selectedCount} 条` : `拒绝 ${selectedCount} 条`"
      :variant="bulkDecision === 'reject' ? 'danger' : 'primary'"
      :busy="bulkActing"
      @confirm="confirmBatchDecision"
      @cancel="bulkDecision = null"
    />
  </section>
</template>

<script setup lang="ts">
import type {
  MatchReviewPage,
  MatchReviewWithBinding,
  ReviewEvidenceType,
  ReviewStatus,
  SongIdentityBinding,
} from '~~/types/match-review'

interface DesiredEvidence { title: string; artists: string[]; album: string }
interface CandidateEvidence { title: string; artist: string; album: string }
interface PlexSearchTrack { ratingKey: string; title: string; artist: string; album: string; plexFilePath: string | null }
interface BatchDecisionResult { decision: 'accept' | 'reject'; requested: number; processed: number; unchanged: number }

const emptyResult = (): MatchReviewPage => ({
  items: [],
  page: 1,
  pageSize: 25,
  total: 0,
  totalPages: 0,
  counts: { pending: 0, accepted: 0, rejected: 0, unbound: 0, superseded: 0, activeBindings: 0 },
  facets: { sources: [], evidenceTypes: [] },
})

const api = useApi()
const route = useRoute()
const router = useRouter()
const result = ref<MatchReviewPage>(emptyResult())
const initialStatus = typeof route.query.reviewStatus === 'string' ? route.query.reviewStatus : 'pending'
const status = ref<ReviewStatus | ''>(
  initialStatus === 'all'
    ? ''
    :
  ['pending', 'accepted', 'rejected', 'unbound', 'superseded', ''].includes(initialStatus)
    ? initialStatus as ReviewStatus | ''
    : 'pending',
)
// Review filtering is intentionally independent from the source selected in
// Overview/History. Entering the review queue therefore defaults to all
// sources, while an explicit review selection remains URL-addressable.
const sourceId = ref(typeof route.query.reviewSource === 'string' ? route.query.reviewSource : '')
const evidenceType = ref<ReviewEvidenceType | ''>(
  typeof route.query.evidence === 'string' ? route.query.evidence as ReviewEvidenceType : '',
)
const page = ref(Number(route.query.page) || 1)
const pageSize = ref([25, 50, 100].includes(Number(route.query.pageSize)) ? Number(route.query.pageSize) : 25)
const loading = ref(false)
const error = ref('')
const actingId = ref('')
const searchingReviewId = ref('')
const searching = ref(false)
const searchResults = ref<PlexSearchTrack[]>([])
const selectedReviews = ref(new Map<string, MatchReviewWithBinding>())
const bulkDecision = ref<'accept' | 'reject' | null>(null)
const bulkActing = ref(false)
const bulkNotice = ref('')
let loadSequence = 0

const pageRangeLabel = computed(() => {
  if (result.value.total === 0) return '0 条'
  const first = (result.value.page - 1) * result.value.pageSize + 1
  const last = Math.min(result.value.page * result.value.pageSize, result.value.total)
  return `${first}–${last} / ${result.value.total} 条`
})
const selectableReviews = computed(() => result.value.items.flatMap(review => review.status === 'pending' ? [review] : []))
const selectedCount = computed(() => selectedReviews.value.size)
const selectedOnCurrentPage = computed(() =>
  selectableReviews.value.filter(review => selectedReviews.value.has(review.id)).length,
)
const allCurrentPageSelected = computed(() =>
  selectableReviews.value.length > 0 && selectedOnCurrentPage.value === selectableReviews.value.length,
)
const someCurrentPageSelected = computed(() =>
  selectedOnCurrentPage.value > 0 && !allCurrentPageSelected.value,
)
const hasOffPageSelection = computed(() => selectedCount.value > selectedOnCurrentPage.value)
const canBatchAccept = computed(() =>
  selectedCount.value > 0
  && [...selectedReviews.value.values()].every(review => Boolean(review.candidatePlexRatingKey)),
)
const batchAcceptDisabledReason = computed(() => {
  if (selectedCount.value === 0) return '请先选择待审核项'
  if (!canBatchAccept.value) return '部分所选记录没有可直接接受的 Plex 候选，请改用单条搜索绑定'
  return ''
})
const bulkConfirmationMessage = computed(() => bulkDecision.value === 'accept'
  ? `将把所选 ${selectedCount.value} 个 Plex 候选设为对应网易云歌曲的全局身份，并在其他歌单中复用。请确认已逐项核对标题、艺人、专辑和路径。整批会原子提交，任一候选失效时不会修改任何记录。`
  : `将拒绝所选 ${selectedCount.value} 个候选；后续同步不会再次推送同一 Plex 文件，但仍可通过“搜索 Plex 库”绑定其他曲目。整批会原子提交。`,
)

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function desired(review: MatchReviewWithBinding): DesiredEvidence {
  const value = asRecord(review.evidence.desired)
  return {
    title: typeof value.title === 'string' ? value.title : '',
    artists: Array.isArray(value.artists) ? value.artists.filter((artist): artist is string => typeof artist === 'string') : [],
    album: typeof value.album === 'string' ? value.album : '',
  }
}
function candidate(review: MatchReviewWithBinding): CandidateEvidence {
  const value = asRecord(review.evidence.candidate)
  return {
    title: typeof value.title === 'string' ? value.title : '',
    artist: typeof value.artist === 'string' ? value.artist : '',
    album: typeof value.album === 'string' ? value.album : '',
  }
}
function reason(review: MatchReviewWithBinding): string {
  return typeof review.evidence.reason === 'string' ? review.evidence.reason : ''
}
function evidenceTypeLabel(value: ReviewEvidenceType): string {
  return ({
    path: '路径证据',
    mb_recording: 'MusicBrainz recording',
    metadata: '弱元数据',
    historical: '历史未验证',
    manual: '人工操作',
    migration: '自动迁移',
  })[value]
}
function evidenceLabel(review: MatchReviewWithBinding): string {
  const musicBrainz = asRecord(review.evidence.musicBrainz)
  const mappings = Array.isArray(musicBrainz.plexIdMappings)
    ? musicBrainz.plexIdMappings.map(asRecord)
    : []
  if (mappings.length > 0) {
    const statuses = mappings.map(mapping => typeof mapping.status === 'string' ? mapping.status : 'unknown')
    const suffix = review.status === 'pending' ? '（删除受保护）' : ''
    if (statuses.includes('failed')) return `Plex MBID 解析失败${suffix}`
    if (statuses.includes('ambiguous')) return `Plex MBID 对应多个 recording${suffix}`
    if (statuses.every(status => status === 'success')) return `Plex release-track 已映射${suffix}`
    return `Plex MBID 尚无 recording${suffix}`
  }
  const label = evidenceTypeLabel(review.evidenceType)
  return review.status === 'pending' ? `${label}（删除受保护）` : label
}
function localMediaLabel(review: MatchReviewWithBinding): string {
  const ownership = review.evidence.localOwnership
  const status = review.evidence.localAssetStatus
  const provenance = review.evidence.localProvenance
  if (ownership !== 'managed' && ownership !== 'external') return ''
  if (status === 'replaced') return 'YunPlex 托管文件已被外部替换，路径信任已撤销'
  if (status === 'missing') return ownership === 'managed' ? 'YunPlex 托管文件缺失' : '外部文件缺失'
  if (ownership === 'managed') return 'YunPlex 托管文件'
  return provenance === 'computed' ? '外部文件 · 路径推算' : '外部文件'
}
function bindingLabel(binding: SongIdentityBinding): string {
  const method = binding.bindingMethod === 'metadata' && binding.evidence.source === 'plex_netease_provider'
    ? '网易云来源身份'
    : ({ manual: '人工确认', mb_recording: 'MB recording', provider_guid: '来源 GUID', metadata: '历史元数据（已退役）', path: '精确路径', migrated: '自动迁移' })[binding.bindingMethod]
  return binding.status === 'active' ? method : `${method} · ${binding.status === 'stale' ? '已失效' : '已解绑'}`
}
function statusLabel(value: ReviewStatus): string {
  return ({ pending: '待审核', accepted: '已接受', rejected: '已拒绝', unbound: '已解绑', superseded: '已替代' })[value]
}
function sourceName(id: string): string {
  return result.value.facets.sources.find(source => source.sourceId === id)?.name || id
}
function isSelected(id: string): boolean {
  return selectedReviews.value.has(id)
}
function replaceSelection(next: Map<string, MatchReviewWithBinding>) {
  selectedReviews.value = next
}
function toggleReview(review: MatchReviewWithBinding) {
  if (review.status !== 'pending' || bulkActing.value) return
  const next = new Map(selectedReviews.value)
  if (next.has(review.id)) next.delete(review.id)
  else next.set(review.id, review)
  replaceSelection(next)
  bulkNotice.value = ''
}
function toggleCurrentPage(event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  const next = new Map(selectedReviews.value)
  for (const review of selectableReviews.value) {
    if (checked) next.set(review.id, review)
    else next.delete(review.id)
  }
  replaceSelection(next)
  bulkNotice.value = ''
}
function clearSelection() {
  replaceSelection(new Map())
  bulkDecision.value = null
}
function removeFromSelection(id: string) {
  if (!selectedReviews.value.has(id)) return
  const next = new Map(selectedReviews.value)
  next.delete(id)
  replaceSelection(next)
}
function requestBatch(decision: 'accept' | 'reject') {
  if (selectedCount.value === 0 || bulkActing.value) return
  if (decision === 'accept' && !canBatchAccept.value) return
  bulkDecision.value = decision
  error.value = ''
  bulkNotice.value = ''
}

async function load() {
  const sequence = ++loadSequence
  loading.value = true
  error.value = ''
  const params: Record<string, string> = {
    page: String(page.value),
    pageSize: String(pageSize.value),
  }
  if (status.value) params.status = status.value
  if (sourceId.value) params.sourceId = sourceId.value
  if (evidenceType.value) params.evidenceType = evidenceType.value
  try {
    const response = await api.get<MatchReviewPage>('/match-reviews', params)
    if (sequence !== loadSequence) return
    result.value = response
    page.value = response.page
    router.replace({ query: {
      ...route.query,
      reviewStatus: status.value === 'pending' ? undefined : status.value || 'all',
      reviewSource: sourceId.value || undefined,
      evidence: evidenceType.value || undefined,
      page: page.value > 1 ? String(page.value) : undefined,
      pageSize: pageSize.value === 25 ? undefined : String(pageSize.value),
    } })
    const nextSelection = new Map(selectedReviews.value)
    for (const review of response.items) {
      if (!nextSelection.has(review.id)) continue
      if (review.status === 'pending') nextSelection.set(review.id, review)
      else nextSelection.delete(review.id)
    }
    replaceSelection(nextSelection)
  } catch (err) {
    if (sequence === loadSequence) error.value = err instanceof Error ? err.message : '加载审核队列失败'
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
}
function applyFilters() {
  page.value = 1
  clearSelection()
  bulkNotice.value = ''
  searchingReviewId.value = ''
  searchResults.value = []
  void load()
}
function goToPage(nextPage: number) {
  page.value = nextPage
  searchingReviewId.value = ''
  searchResults.value = []
  void load()
}
async function accept(review: MatchReviewWithBinding, ratingKey: string | null) {
  if (!ratingKey) return
  actingId.value = review.id
  error.value = ''
  try {
    await api.post(`/match-reviews/${review.id}/decision`, { decision: 'accept', ratingKey })
    removeFromSelection(review.id)
    searchingReviewId.value = ''
    searchResults.value = []
    await load()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '建立绑定失败'
  } finally {
    actingId.value = ''
  }
}
async function reject(review: MatchReviewWithBinding) {
  actingId.value = review.id
  error.value = ''
  try {
    await api.post(`/match-reviews/${review.id}/decision`, { decision: 'reject' })
    removeFromSelection(review.id)
    await load()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '拒绝候选失败'
  } finally {
    actingId.value = ''
  }
}
async function unbind(review: MatchReviewWithBinding) {
  actingId.value = review.id
  error.value = ''
  try {
    await api.post(`/match-reviews/${review.id}/unbind`)
    await load()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '解除绑定失败'
  } finally {
    actingId.value = ''
  }
}
async function searchLibrary(review: MatchReviewWithBinding) {
  if (searchingReviewId.value === review.id) {
    searchingReviewId.value = ''
    searchResults.value = []
    return
  }
  const title = desired(review).title || candidate(review).title
  if (!title) {
    error.value = '该历史记录没有可用于搜索的歌曲标题'
    return
  }
  searchingReviewId.value = review.id
  searchResults.value = []
  searching.value = true
  error.value = ''
  try {
    const response = await api.get<{ tracks: PlexSearchTrack[] }>('/match-reviews/plex-search', { title })
    if (searchingReviewId.value === review.id) searchResults.value = response.tracks
  } catch (err) {
    error.value = err instanceof Error ? err.message : '搜索 Plex 失败'
  } finally {
    searching.value = false
  }
}

async function confirmBatchDecision() {
  const decision = bulkDecision.value
  if (!decision || selectedCount.value === 0 || bulkActing.value) return
  const ids = [...selectedReviews.value.keys()]
  bulkActing.value = true
  error.value = ''
  try {
    const response = await api.post<BatchDecisionResult>('/match-reviews/batch', { ids, decision })
    bulkNotice.value = decision === 'accept'
      ? `已建立 ${response.processed} 个全局歌曲绑定${response.unchanged > 0 ? `，${response.unchanged} 条状态未变化` : ''}。`
      : `已拒绝 ${response.processed} 个候选${response.unchanged > 0 ? `，${response.unchanged} 条状态未变化` : ''}。`
    clearSelection()
    await load()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '批量审核失败'
    bulkDecision.value = null
    await load()
  } finally {
    bulkActing.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.match-reviews-page { width: 100%; min-width: 0; }
.review-summary { display: flex; align-items: center; gap: 2rem; padding: 1rem 1.25rem; }
.review-summary > div { display: flex; gap: .55rem; align-items: baseline; color: var(--text-muted); font-size: .78rem; }
.review-summary strong { font-size: 1.25rem; color: var(--text-primary); }
.review-summary > p { margin-left: auto; color: var(--text-muted-deep); font-size: .75rem; }
.review-toolbar { display: grid; grid-template-columns: minmax(9rem, 1fr) minmax(13rem, 1.6fr) minmax(12rem, 1.35fr) minmax(7rem, .65fr); gap: .75rem; padding: 1rem 1.25rem; }
.review-filter { display: flex; flex-direction: column; gap: .35rem; min-width: 0; }
.review-filter > span { color: var(--text-muted-deep); font-size: .7rem; font-weight: 600; }
.review-error, .review-notice { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 1rem 1.25rem; font-size: .8rem; }
.review-error { color: var(--danger); }
.review-notice { justify-content: flex-start; color: var(--success); border-color: color-mix(in srgb, var(--success) 30%, var(--border-primary)); }
.review-notice .btn { margin-left: auto; }
.review-bulk-toolbar { position: sticky; top: .75rem; z-index: 10; display: grid; grid-template-columns: minmax(13rem, 1fr) minmax(12rem, 1fr) auto; align-items: center; gap: 1rem; padding: .8rem 1rem; box-shadow: var(--shadow-sm); }
.review-bulk-select { display: flex; min-height: 2.75rem; align-items: center; gap: .65rem; cursor: pointer; color: var(--text-primary); font-size: .78rem; font-weight: 650; }
.review-bulk-select input, .review-card__select input { width: 1rem; height: 1rem; accent-color: var(--accent); cursor: pointer; }
.review-bulk-select small { color: var(--text-muted-deep); font-size: .68rem; font-weight: 500; }
.review-bulk-summary { display: flex; min-width: 0; flex-direction: column; font-size: .74rem; }
.review-bulk-summary strong { color: var(--text-primary); }
.review-bulk-summary span { color: var(--text-muted-deep); }
.review-bulk-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: .5rem; }
.review-bulk-actions .btn { min-height: 2.75rem; }
.review-card { padding: 1.1rem 1.25rem; transition: border-color 160ms ease, background-color 160ms ease, box-shadow 160ms ease; }
.review-card--selected { border-color: color-mix(in srgb, var(--accent) 55%, var(--border-primary)); background: color-mix(in srgb, var(--accent-muted) 32%, var(--bg-surface)); box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 16%, transparent); }
.review-card__header { display: flex; justify-content: space-between; gap: 1rem; }
.review-card__identity { display: flex; min-width: 0; align-items: flex-start; gap: .7rem; }
.review-card__select { display: grid; width: 2.75rem; height: 2.75rem; flex: 0 0 2.75rem; cursor: pointer; place-items: center; margin: -.55rem 0 -.55rem -.55rem; }
.review-card h2 { font-size: 1rem; font-weight: 700; color: var(--text-primary); }
.review-card__eyebrow { margin-bottom: .2rem; font-size: .68rem; color: var(--text-muted-deep); }
.review-status { height: max-content; white-space: nowrap; padding: .2rem .5rem; border-radius: .4rem; font-size: .72rem; font-weight: 700; }
.review-status--pending { color: var(--warning); background: color-mix(in srgb, var(--warning) 13%, transparent); }
.review-status--accepted { color: var(--success); background: color-mix(in srgb, var(--success) 13%, transparent); }
.review-status--rejected, .review-status--unbound, .review-status--superseded { color: var(--text-muted); background: var(--bg-hover); }
.review-evidence { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .75rem; margin-top: 1rem; }
.review-evidence > div { display: flex; min-width: 0; flex-direction: column; gap: .18rem; padding: .7rem; border: 1px solid var(--border-primary); border-radius: .55rem; background: var(--bg-app); }
.review-evidence span, .review-evidence small { font-size: .68rem; color: var(--text-muted-deep); }
.review-evidence strong { font-size: .8rem; color: var(--text-primary); }
.review-evidence .review-media-origin { color: var(--warning); font-weight: 650; }
.review-reason { margin-top: .7rem; font-size: .75rem; color: var(--warning); }
.review-card__actions { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: 1rem; }
.review-card__actions .btn, .review-search__track .btn, .review-pagination .btn { min-height: 2.75rem; }
.review-search { margin-top: .8rem; padding: .75rem; border-top: 1px solid var(--border-primary); }
.review-search__track { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .55rem 0; border-bottom: 1px solid var(--border-primary); }
.review-search__track div { display: flex; min-width: 0; flex-direction: column; font-size: .75rem; }
.review-search__track span, .review-search__track small { overflow-wrap: anywhere; color: var(--text-muted-deep); }
.review-pagination { display: flex; align-items: center; justify-content: center; gap: 1rem; padding: .8rem 1rem; }
.review-pagination > span { min-width: 15rem; text-align: center; color: var(--text-muted); font-size: .75rem; }

@media (prefers-reduced-motion: reduce) {
  .review-card { transition: none; }
}
@media (max-width: 900px) {
  .review-bulk-toolbar { grid-template-columns: 1fr 1fr; }
  .review-bulk-actions { grid-column: 1 / -1; justify-content: flex-start; }
}
@media (max-width: 850px) {
  .review-toolbar { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .review-evidence { grid-template-columns: 1fr; }
}
@media (max-width: 600px) {
  .review-summary { flex-wrap: wrap; gap: 1rem; }
  .review-summary > p { width: 100%; margin-left: 0; }
  .review-toolbar, .review-bulk-toolbar { grid-template-columns: 1fr; }
  .review-bulk-actions { grid-column: auto; }
  .review-bulk-actions .btn { flex: 1 1 8rem; }
  .review-card__header { align-items: flex-start; }
  .review-search__track { align-items: flex-start; flex-direction: column; }
  .review-search__track .btn { width: 100%; }
  .review-pagination { flex-wrap: wrap; justify-content: space-between; }
  .review-pagination > span { order: -1; width: 100%; min-width: 0; }
}
</style>
