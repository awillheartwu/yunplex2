import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import type {
  InitializationCandidate,
  InitializationDecision,
  InitializationItemsPage,
  InitializationReviewItem,
  InitializationSelectionFilter,
  SourceInitializationSummary,
} from '../server/lib/source-initialization/types'
import type { CandidateScore } from '../shared/initialization-scoring'
import { evidenceGroups } from '../shared/review-filter-groups'
import { sseSubscribe } from './sse'
import type { DeferredInitializationGroup, InitializationProcessing } from '../shared/source-onboarding'

export type { InitializationDecision, InitializationItemsPage, InitializationReviewItem, SourceInitializationSummary }

export interface SourceInitializationApi {
  get<T>(path: string, params?: Record<string, string>): Promise<T>
  post<T>(path: string, body?: unknown): Promise<T>
  put<T>(path: string, body?: unknown): Promise<T>
}

export interface SourceInitializationSnapshot {
  applicable: boolean
  initialization: SourceInitializationSummary | null
  libraryChangedAt?: string | null
  processing?: InitializationProcessing | null
  deferredGroups?: DeferredInitializationGroup[]
}

export interface PlexSearchResult {
  ratingKey: string
  title: string
  artist: string
  album: string
  plexFilePath: string
}

interface UseSourceInitializationOptions {
  sourceId: string
  api?: SourceInitializationApi
  pollIntervalMs?: number
  searchDelayMs?: number
  registerLifecycle?: boolean
  onChanged?: () => void
}

const tierLabels: Record<string, string> = {
  strong_id: '明确匹配',
  high_confidence: '推荐匹配',
  possible: '需要核对',
  ambiguous: '多个相近结果',
  unmatched: '未匹配',
  metadata_missing: '信息不完整',
  conflict: '冲突',
  preserved: '已确认文件',
}

const evidenceLabels: Record<string, string> = {
  active_binding_verified: '现有绑定的 Plex 媒体和文件路径仍然有效，将直接保留，无需重新选择。',
  unique_netease_path_id: '文件路径包含唯一且精确的网易云歌曲 ID，并通过版本与时长校验。',
  strict_local_metadata: '标题与版本、完整艺人、专辑、曲号和时长均严格一致。',
  title_artist_duration: '标题、主要艺人和时长一致，但专辑或曲号证据不完整。',
  title_only_candidate: '仅找到一个同名候选，但艺人或时长证据不足，需要人工核对。',
  multiple_local_candidates: '存在多个本地候选，需要人工选择。',
  no_local_candidate: 'Plex 音乐库中没有符合固定规则的候选。',
  netease_metadata_missing: '网易云仅返回歌曲 ID，缺少可用于比较的元数据。',
}

export function tierLabel(value: string): string {
  return tierLabels[value] || value
}

export function evidenceRuleLabel(item: InitializationReviewItem): string {
  if (item.evidence.rule === 'enhanced_metadata') {
    const reasons = Array.isArray(item.evidence.reasons) ? item.evidence.reasons : []
    const conflicts = Array.isArray(item.evidence.conflicts) ? item.evidence.conflicts : []
    return [...reasons, ...conflicts].join('；') || '增强匹配候选，请检查证据后确认。'
  }
  const rule = String(item.evidence.rule || '')
  return evidenceLabels[rule] || (item.kind === 'preserved' ? '现有绑定将直接保留，无需重新选择。' : '该项需要结合两侧字段和路径人工核对。')
}

/** Scores are presentation-only ranking aids; they never authorize a media binding. */
export interface ScoredCandidate {
  candidate: InitializationCandidate
  score: CandidateScore
}

/** Older drafts and non-scored candidates omit `scoredCandidates`; unknown shapes are skipped. */
export function scoredCandidatesOf(item: InitializationReviewItem): ScoredCandidate[] {
  const value = item.evidence.scoredCandidates
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is ScoredCandidate => {
    if (!entry || typeof entry !== 'object') return false
    const { candidate, score } = entry as { candidate?: unknown; score?: { total?: unknown } }
    return Boolean(candidate) && typeof score?.total === 'number'
  })
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export function useSourceInitialization(options: UseSourceInitializationOptions) {
  const api = options.api || useApi()
  const initialization = ref<SourceInitializationSummary | null>(null)
  const processing = ref<InitializationProcessing | null>(null)
  const deferredGroups = ref<DeferredInitializationGroup[]>([])
  const libraryChangedAt = ref<string | null>(null)
  const libraryChanged = computed(() => initialization.value?.status === 'awaiting_review'
    && Boolean(initialization.value.analyzedAt && libraryChangedAt.value
      && Date.parse(libraryChangedAt.value) > Date.parse(initialization.value.analyzedAt)))
  const loading = ref(true)
  const loadingItems = ref(false)
  const acting = ref(false)
  const error = ref('')
  const itemsError = ref('')
  const result = ref<InitializationItemsPage>({ items: [], total: 0, selectableTotal: 0, adoptableTotal: 0, page: 1, pageSize: 50 })
  const tier = ref('')
  const decision = ref('')
  const search = ref('')
  const selected = ref(new Set<number>())
  const allMatchingSelected = ref(false)
  const excluded = ref(new Set<number>())
  const drawerItem = ref<InitializationReviewItem | null>(null)
  const searchResults = ref<PlexSearchResult[]>([])

  const isAnalyzing = computed(() => ['analyzing', 'applying'].includes(initialization.value?.status || ''))
  const isWaitingAnalysis = computed(() => initialization.value?.status === 'pending' && initialization.value.requestStatus === 'pending')
  const isQuickQueued = computed(() => initialization.value?.quickStatus === 'queued')
  const isEditable = computed(() => initialization.value?.status === 'awaiting_review' && initialization.value.rulesCompatible && !isQuickQueued.value)
  const needsRestart = computed(() => Boolean(initialization.value && ['awaiting_review', 'completed'].includes(initialization.value.status) && !initialization.value.rulesCompatible))
  const canReview = computed(() => Boolean(initialization.value && ['awaiting_review', 'completed'].includes(initialization.value.status)))
  const itemRules = reactive(new Map<number, InitializationReviewItem>())
  const selectionCategory = computed(() => evidenceGroups.find(group => group.value === tier.value || group.members.includes(tier.value)))
  const selectionCategoryLabel = computed(() => tierLabels[tier.value] || selectionCategory.value?.label || '')
  const canSelectAllMatching = computed(() => Boolean(isEditable.value && !acting.value && !loadingItems.value && !itemsError.value && selectionCategory.value && tier.value !== 'preserved' && result.value.selectableTotal > 0))
  const selectedCount = computed(() => allMatchingSelected.value ? Math.max(0, result.value.selectableTotal - excluded.value.size) : selected.value.size)
  const selectedAdoptableCount = computed(() => allMatchingSelected.value
    ? result.value.adoptableTotal - [...excluded.value].filter(isAdoptableSong).length
    : [...selected.value].filter(isAdoptableSong).length)
  const canAdoptSelected = computed(() => selectedCount.value > 0 && selectedAdoptableCount.value === selectedCount.value)
  let snapshotRequest = 0
  let itemsRequest = 0
  let searchTimer: ReturnType<typeof setTimeout> | null = null
  let pollingTimer: ReturnType<typeof setInterval> | null = null
  let disposed = false
  let noticeRequest = 0
  let nextNoticePollAt = 0
  const noticeUnsubscribers: Array<() => void> = []

  function clearSelection(): void {
    selected.value = new Set()
    allMatchingSelected.value = false
    excluded.value = new Set()
  }

  const stopSelectionWatch = watch([tier, decision, search], () => {
    clearSelection()
    itemsRequest += 1
    loadingItems.value = true
  }, { flush: 'sync' })
  const stopEditableWatch = watch(isEditable, editable => { if (!editable) clearSelection() })

  function setActionError(message: string): void {
    error.value = message
  }

  function rememberItems(items: InitializationReviewItem[]): void {
    for (const item of items) itemRules.set(item.neteaseSongId, item)
  }

  function resetReviewState(): void {
    result.value = { items: [], total: 0, selectableTotal: 0, adoptableTotal: 0, page: 1, pageSize: 50 }
    clearSelection()
    itemRules.clear()
    drawerItem.value = null
    searchResults.value = []
  }

  async function reloadItems(page = result.value.page): Promise<void> {
    const request = ++itemsRequest
    const initializationId = initialization.value?.id
    if (!initializationId) return
    loadingItems.value = true
    itemsError.value = ''
    try {
      const next = await api.get<InitializationItemsPage>(`/playlist-sources/${options.sourceId}/initialization/items`, {
        tier: tier.value,
        decision: decision.value,
        search: search.value,
        page: String(page),
        pageSize: '50',
      })
      if (disposed || request !== itemsRequest || initialization.value?.id !== initializationId) return
      result.value = next
      rememberItems(next.items)
    } catch (value) {
      if (!disposed && request === itemsRequest) {
        itemsError.value = errorMessage(value, '接管项加载失败')
        error.value = itemsError.value
      }
    } finally {
      if (!disposed && request === itemsRequest) loadingItems.value = false
    }
  }

  async function load(options_: { quiet?: boolean } = {}): Promise<void> {
    const request = ++snapshotRequest
    if (!options_.quiet) error.value = ''
    if (!options_.quiet) loading.value = true
    try {
      const data = await api.get<SourceInitializationSnapshot>(`/playlist-sources/${options.sourceId}/initialization`)
      if (disposed || request !== snapshotRequest) return
      const previousId = initialization.value?.id
      const previousRevision = initialization.value?.revision
      const previousStatus = initialization.value?.status
      initialization.value = data.initialization
      processing.value = data.processing ?? null
      deferredGroups.value = data.deferredGroups ?? []
      libraryChangedAt.value = data.libraryChangedAt ?? null
      if (previousId !== data.initialization?.id) resetReviewState()
      if (data.initialization && ['awaiting_review', 'completed'].includes(data.initialization.status)) {
        if (!options_.quiet || previousId !== data.initialization.id || previousRevision !== data.initialization.revision || previousStatus !== data.initialization.status) await reloadItems(previousId === data.initialization.id ? result.value.page : 1)
      } else if (!data.initialization || !['awaiting_review', 'completed'].includes(data.initialization.status)) {
        resetReviewState()
      }
    } catch (value) {
      if (!disposed && request === snapshotRequest) error.value = errorMessage(value, '加载失败')
    } finally {
      if (!disposed && request === snapshotRequest) loading.value = false
    }
  }

  function ensureEditable(): boolean {
    if (acting.value) return false
    if (!isEditable.value) {
      setActionError(isQuickQueued.value ? '快速方案已提交，等待后台处理' : needsRestart.value ? '候选规则已更新，请先重新分析' : '当前接管方案不可编辑')
      return false
    }
    return true
  }

  function canChoose(item: InitializationReviewItem, value: InitializationDecision): boolean {
    return item.kind === 'actionable' && item.allowedDecisions.includes(value)
  }

  function isAdoptableSong(songId: number): boolean {
    const item = itemRules.get(songId)
    return Boolean(item && canChoose(item, 'adopt'))
  }

  async function start(autoProcess = false): Promise<void> {
    if (acting.value) return
    acting.value = true
    error.value = ''
    try {
      await api.post(`/playlist-sources/${options.sourceId}/initialization/start`, { autoProcess })
      await load()
    } catch (value) {
      error.value = errorMessage(value, '启动失败')
    } finally {
      acting.value = false
    }
  }

  async function cancel(): Promise<void> {
    if (acting.value || (!isAnalyzing.value && !isWaitingAnalysis.value && !isQuickQueued.value)) return
    acting.value = true
    try {
      await api.post(`/playlist-sources/${options.sourceId}/initialization/cancel`, {})
      await load()
    } catch (value) {
      error.value = errorMessage(value, '取消失败')
    } finally {
      acting.value = false
    }
  }

  async function skip(): Promise<void> {
    if (acting.value || initialization.value?.status !== 'pending') return
    acting.value = true
    try {
      await api.post(`/playlist-sources/${options.sourceId}/initialization/skip`, { confirmRisk: true, initializationId: initialization.value?.id })
      options.onChanged?.()
      await load()
    } catch (value) {
      error.value = errorMessage(value, '跳过失败')
    } finally {
      acting.value = false
    }
  }

  async function restart(): Promise<void> {
    const current = initialization.value
    if (acting.value || !current) return
    acting.value = true
    error.value = ''
    try {
      await api.post(`/playlist-sources/${options.sourceId}/initialization/restart`, { initializationId: current.id })
      clearSelection()
      options.onChanged?.()
      await load()
    } catch (value) {
      error.value = errorMessage(value, '重新分析失败')
    } finally {
      acting.value = false
    }
  }

  async function setDecision(payload: { songIds?: number[]; tier?: string; filter?: InitializationSelectionFilter; decision: InitializationDecision }): Promise<void> {
    if (!ensureEditable()) return
    const ids = payload.songIds || []
    // A tier-wide action includes unloaded pages; cached rows cannot establish its eligibility.
    // The server validates the draft and limits adoption to rows with a candidate.
    if (!payload.tier && !payload.filter) {
      const candidateItems = ids.map(id => itemRules.get(id))
      if (!candidateItems.length || candidateItems.some(item => !item || !canChoose(item, payload.decision))) {
        setActionError('所选歌曲当前不允许这个处理决定，请刷新后重试')
        return
      }
    }
    error.value = ''
    acting.value = true
    try {
      await api.put(`/playlist-sources/${options.sourceId}/initialization/decisions`, {
        ...payload,
        initializationId: initialization.value?.id,
      })
      clearSelection()
      await load()
    } catch (value) {
      error.value = errorMessage(value, '更新草案失败')
    } finally {
      acting.value = false
    }
  }

  function decideOne(songId: number, value: InitializationDecision): Promise<void> {
    return setDecision({ songIds: [songId], decision: value })
  }

  function decideSelected(value: InitializationDecision): Promise<void> {
    if (allMatchingSelected.value) {
      if (!canSelectAllMatching.value || !selectedCount.value || (value === 'adopt' && !canAdoptSelected.value)) {
        setActionError('请检查当前分类和所选歌曲的候选，再批量修改')
        return Promise.resolve()
      }
      return setDecision({
        filter: { tier: tier.value, decision: decision.value ? decision.value as InitializationDecision : undefined, search: search.value, excludeSongIds: [...excluded.value] },
        decision: value,
      })
    }
    return setDecision({ songIds: [...selected.value], decision: value })
  }

  function adoptAllHighConfidence(): Promise<void> {
    return setDecision({ tier: 'high_confidence', decision: 'adopt' })
  }

  function isSelectable(item: InitializationReviewItem): boolean {
    return Boolean(isEditable.value && item.kind === 'actionable' && item.allowedDecisions.length)
  }

  function isSelected(item: InitializationReviewItem): boolean {
    return allMatchingSelected.value ? isSelectable(item) && !excluded.value.has(item.neteaseSongId) : selected.value.has(item.neteaseSongId)
  }

  function selectAllMatching(): void {
    if (!canSelectAllMatching.value) return
    clearSelection()
    allMatchingSelected.value = true
  }

  function toggle(item: InitializationReviewItem): void {
    if (acting.value || loadingItems.value || !isSelectable(item)) return
    if (allMatchingSelected.value) {
      const next = new Set(excluded.value)
      if (next.has(item.neteaseSongId)) next.delete(item.neteaseSongId)
      else next.add(item.neteaseSongId)
      excluded.value = next
      return
    }
    const next = new Set(selected.value)
    if (next.has(item.neteaseSongId)) next.delete(item.neteaseSongId)
    else next.add(item.neteaseSongId)
    selected.value = next
  }

  function togglePage(): void {
    if (acting.value || loadingItems.value) return
    const pageItems = result.value.items.filter(isSelectable)
    const allSelected = pageItems.length > 0 && pageItems.every(isSelected)
    if (allMatchingSelected.value) {
      const next = new Set(excluded.value)
      for (const item of pageItems) {
        if (allSelected) next.add(item.neteaseSongId)
        else next.delete(item.neteaseSongId)
      }
      excluded.value = next
      return
    }
    const next = new Set(selected.value)
    for (const item of pageItems) {
      if (allSelected) next.delete(item.neteaseSongId)
      else next.add(item.neteaseSongId)
    }
    selected.value = next
  }

  function onSearch(value: string): void {
    search.value = value
    result.value.page = 1
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      searchTimer = null
      void reloadItems(1)
    }, options.searchDelayMs ?? 250)
  }

  function clearFilters(): void {
    search.value = ''
    tier.value = ''
    decision.value = ''
    result.value.page = 1
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = null
    void reloadItems(1)
  }

  function changePage(page: number): void {
    const maxPage = Math.max(1, Math.ceil(result.value.total / result.value.pageSize))
    const nextPage = Math.min(Math.max(page, 1), maxPage)
    result.value.page = nextPage
    void reloadItems(nextPage)
  }

  function openDrawer(item: InitializationReviewItem): void {
    drawerItem.value = item
    searchResults.value = []
  }

  async function searchPlex(item: InitializationReviewItem): Promise<void> {
    if (!ensureEditable() || item.kind !== 'actionable' || !item.canSearch) {
      if (isEditable.value && item.kind === 'actionable' && !item.canSearch) setActionError(item.unavailableReason || '当前歌曲不可搜索 Plex')
      return
    }
    try {
      const data = await api.get<{ tracks: PlexSearchResult[] }>('/match-management/plex-search', { title: item.title })
      if (drawerItem.value?.neteaseSongId === item.neteaseSongId) searchResults.value = data.tracks
    } catch (value) {
      error.value = errorMessage(value, '搜索 Plex 失败')
    }
  }

  async function chooseCandidate(item: InitializationReviewItem, candidate: { ratingKey: string }): Promise<void> {
    if (!ensureEditable() || item.kind !== 'actionable' || !item.canSearch) return
    acting.value = true
    try {
      await api.put(`/playlist-sources/${options.sourceId}/initialization/candidate`, {
        initializationId: initialization.value?.id,
        songId: item.neteaseSongId,
        ratingKey: candidate.ratingKey,
      })
      drawerItem.value = null
      await load()
    } catch (value) {
      error.value = errorMessage(value, '选择 Plex 媒体失败')
    } finally {
      acting.value = false
    }
  }

  async function confirmSharedMedia(item: InitializationReviewItem): Promise<void> {
    if (!ensureEditable() || item.kind !== 'actionable' || !item.evidence.sharedMediaFingerprint) return
    error.value = ''
    acting.value = true
    try {
      await api.put(`/playlist-sources/${options.sourceId}/initialization/shared-media`, {
        initializationId: initialization.value?.id, songId: item.neteaseSongId, fingerprint: item.evidence.sharedMediaFingerprint,
      })
      drawerItem.value = null
      await load()
    } catch (value) { error.value = errorMessage(value, '确认共享媒体失败') }
    finally { acting.value = false }
  }

  async function arrange(scope: 'default' | 'deferred' | 'needs_review' | 'conflict' | 'selected', selection: { songIds?: number[]; filter?: InitializationSelectionFilter } = {}): Promise<boolean> {
    if (!ensureEditable() || !initialization.value) return false
    acting.value = true
    error.value = ''
    try {
      await api.post(`/playlist-sources/${options.sourceId}/initialization/arrange`, { initializationId: initialization.value.id, scope, ...selection })
      clearSelection()
      await load()
      options.onChanged?.()
      return true
    } catch (value) { error.value = errorMessage(value, '自动安排失败'); return false }
    finally { acting.value = false }
  }

  async function adoptFirstSelected(): Promise<void> {
    if (!selectedCount.value) return
    await arrange('selected', allMatchingSelected.value
      ? { filter: { tier: tier.value, decision: decision.value ? decision.value as InitializationDecision : undefined, search: search.value, excludeSongIds: [...excluded.value] } }
      : { songIds: [...selected.value] })
  }

  async function commit(confirmDeferred = false): Promise<boolean> {
    const current = initialization.value
    if (acting.value || !current || !isEditable.value) {
      if (current && !isEditable.value) setActionError(isQuickQueued.value ? '快速方案已提交，等待后台处理' : '候选规则已更新，请先重新分析')
      return false
    }
    acting.value = true
    error.value = ''
    try {
      await api.post(`/playlist-sources/${options.sourceId}/initialization/commit`, { initializationId: current.id, confirmDeferred })
      options.onChanged?.()
      await load()
      return true
    } catch (value) {
      error.value = errorMessage(value, '提交失败')
      return false
    } finally {
      acting.value = false
    }
  }

  function dispose(): void {
    disposed = true
    noticeRequest++
    noticeUnsubscribers.splice(0).forEach(unsubscribe => unsubscribe())
    stopSelectionWatch()
    stopEditableWatch()
    if (searchTimer) clearTimeout(searchTimer)
    if (pollingTimer) clearInterval(pollingTimer)
    searchTimer = null
    pollingTimer = null
  }

  async function refreshLibraryNotice(): Promise<void> {
    const request = ++noticeRequest
    try {
      const data = await api.get<SourceInitializationSnapshot>(`/playlist-sources/${options.sourceId}/initialization`)
      if (!disposed && request === noticeRequest) libraryChangedAt.value = data.libraryChangedAt ?? null
    } catch { /* This hint must not disturb draft choices or page errors. */ }
  }

  if (options.registerLifecycle !== false) {
    onMounted(() => {
      disposed = false
      void load()
      for (const event of ['plex-library-change', 'resync'] as const) noticeUnsubscribers.push(sseSubscribe(event, () => { void refreshLibraryNotice() }))
      pollingTimer = setInterval(() => {
        if (isAnalyzing.value || isWaitingAnalysis.value || isQuickQueued.value || processing.value?.active) void load({ quiet: true })
        else if (initialization.value?.status === 'awaiting_review' && Date.now() >= nextNoticePollAt) {
          nextNoticePollAt = Date.now() + 30_000
          void refreshLibraryNotice()
        }
      }, options.pollIntervalMs ?? 2500)
    })
    onUnmounted(dispose)
  }

  return {
    initialization,
    processing,
    deferredGroups,
    libraryChanged,
    loading,
    loadingItems,
    acting,
    error,
    itemsError,
    result,
    tier,
    decision,
    search,
    selected,
    selectedCount,
    allMatchingSelected,
    selectionCategoryLabel,
    canSelectAllMatching,
    canAdoptSelected,
    drawerItem,
    searchResults,
    isAnalyzing,
    isWaitingAnalysis,
    isEditable,
    isQuickQueued,
    needsRestart,
    canReview,
    tierLabel,
    evidenceRuleLabel,
    load,
    reloadItems,
    start,
    cancel,
    skip,
    restart,
    decideOne,
    decideSelected,
    adoptAllHighConfidence,
    isSelectable,
    isSelected,
    toggle,
    togglePage,
    selectAllMatching,
    clearSelection,
    onSearch,
    clearFilters,
    changePage,
    openDrawer,
    searchPlex,
    chooseCandidate,
    confirmSharedMedia,
    commit,
    arrange,
    adoptFirstSelected,
    dispose,
  }
}
