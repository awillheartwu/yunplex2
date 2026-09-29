import { computed, onMounted, onUnmounted, ref } from 'vue'
import type {
  InitializationDecision,
  InitializationItemsPage,
  InitializationReviewItem,
  SourceInitializationSummary,
} from '../server/lib/source-initialization/types'

export type { InitializationDecision, InitializationItemsPage, InitializationReviewItem, SourceInitializationSummary }

export interface SourceInitializationApi {
  get<T>(path: string, params?: Record<string, string>): Promise<T>
  post<T>(path: string, body?: unknown): Promise<T>
  put<T>(path: string, body?: unknown): Promise<T>
}

export interface SourceInitializationSnapshot {
  applicable: boolean
  initialization: SourceInitializationSummary | null
  downloadConcurrency: number
  convergenceQueueDepth: number
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
  strong_id: '强身份',
  high_confidence: '高置信',
  possible: '可能候选',
  ambiguous: '歧义',
  unmatched: '未匹配',
  metadata_missing: '元数据缺失',
  conflict: '冲突',
  preserved: '已有绑定',
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

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export function useSourceInitialization(options: UseSourceInitializationOptions) {
  const api = options.api || useApi()
  const initialization = ref<SourceInitializationSummary | null>(null)
  const downloadConcurrency = ref(1)
  const queueDepth = ref(0)
  const loading = ref(true)
  const loadingItems = ref(false)
  const acting = ref(false)
  const error = ref('')
  const itemsError = ref('')
  const result = ref<InitializationItemsPage>({ items: [], total: 0, page: 1, pageSize: 50 })
  const tier = ref('')
  const decision = ref('')
  const search = ref('')
  const selected = ref(new Set<number>())
  const drawerItem = ref<InitializationReviewItem | null>(null)
  const searchResults = ref<PlexSearchResult[]>([])

  const isAnalyzing = computed(() => ['analyzing', 'applying'].includes(initialization.value?.status || ''))
  const isWaitingAnalysis = computed(() => initialization.value?.status === 'pending' && initialization.value.requestStatus === 'pending')
  const isEditable = computed(() => initialization.value?.status === 'awaiting_review' && initialization.value.rulesCompatible)
  const needsRestart = computed(() => Boolean(initialization.value && ['awaiting_review', 'completed'].includes(initialization.value.status) && !initialization.value.rulesCompatible))
  const canReview = computed(() => Boolean(initialization.value && ['awaiting_review', 'completed'].includes(initialization.value.status)))
  const itemRules = new Map<number, InitializationReviewItem>()
  let snapshotRequest = 0
  let itemsRequest = 0
  let searchTimer: ReturnType<typeof setTimeout> | null = null
  let pollingTimer: ReturnType<typeof setInterval> | null = null
  let disposed = false

  function setActionError(message: string): void {
    error.value = message
  }

  function rememberItems(items: InitializationReviewItem[]): void {
    for (const item of items) itemRules.set(item.neteaseSongId, item)
  }

  function resetReviewState(): void {
    result.value = { items: [], total: 0, page: 1, pageSize: 50 }
    selected.value = new Set()
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
    loading.value = true
    try {
      const data = await api.get<SourceInitializationSnapshot>(`/playlist-sources/${options.sourceId}/initialization`)
      if (disposed || request !== snapshotRequest) return
      const previousId = initialization.value?.id
      initialization.value = data.initialization
      downloadConcurrency.value = data.downloadConcurrency
      queueDepth.value = data.convergenceQueueDepth
      if (previousId !== data.initialization?.id) resetReviewState()
      if (data.initialization && ['awaiting_review', 'completed'].includes(data.initialization.status)) {
        await reloadItems(1)
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
      setActionError(needsRestart.value ? '候选规则已更新，请先重新分析' : '当前接管方案不可编辑')
      return false
    }
    return true
  }

  function canChoose(item: InitializationReviewItem, value: InitializationDecision): boolean {
    return item.kind === 'actionable' && item.allowedDecisions.includes(value)
  }

  async function start(): Promise<void> {
    if (acting.value) return
    acting.value = true
    error.value = ''
    try {
      await api.post(`/playlist-sources/${options.sourceId}/initialization/start`, {})
      await load()
    } catch (value) {
      error.value = errorMessage(value, '启动失败')
    } finally {
      acting.value = false
    }
  }

  async function cancel(): Promise<void> {
    if (acting.value || (!isAnalyzing.value && !isWaitingAnalysis.value)) return
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
      selected.value = new Set()
      options.onChanged?.()
      await load()
    } catch (value) {
      error.value = errorMessage(value, '重新分析失败')
    } finally {
      acting.value = false
    }
  }

  async function setDecision(payload: { songIds?: number[]; tier?: string; decision: InitializationDecision }): Promise<void> {
    if (!ensureEditable()) return
    const ids = payload.songIds || []
    const candidateItems = payload.tier
      ? [...itemRules.values()].filter(item => item.tier === payload.tier)
      : ids.map(id => itemRules.get(id))
    if (!candidateItems.length || candidateItems.some(item => !item || !canChoose(item, payload.decision))) {
      setActionError('所选歌曲当前不允许这个处理决定，请刷新后重试')
      return
    }
    acting.value = true
    try {
      await api.put(`/playlist-sources/${options.sourceId}/initialization/decisions`, {
        ...payload,
        initializationId: initialization.value?.id,
      })
      selected.value = new Set()
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
    return setDecision({ songIds: [...selected.value], decision: value })
  }

  function adoptAllHighConfidence(): Promise<void> {
    return setDecision({ tier: 'high_confidence', decision: 'adopt' })
  }

  function isSelectable(item: InitializationReviewItem): boolean {
    return Boolean(isEditable.value && item.kind === 'actionable' && item.allowedDecisions.length)
  }

  function toggle(item: InitializationReviewItem): void {
    if (!isSelectable(item)) return
    const next = new Set(selected.value)
    if (next.has(item.neteaseSongId)) next.delete(item.neteaseSongId)
    else next.add(item.neteaseSongId)
    selected.value = next
  }

  function togglePage(): void {
    const pageItems = result.value.items.filter(isSelectable)
    const allSelected = pageItems.length > 0 && pageItems.every(item => selected.value.has(item.neteaseSongId))
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

  async function commit(): Promise<void> {
    const current = initialization.value
    if (acting.value || !current || !isEditable.value) {
      if (current && !isEditable.value) setActionError('候选规则已更新，请先重新分析')
      return
    }
    acting.value = true
    try {
      await api.post(`/playlist-sources/${options.sourceId}/initialization/commit`, { initializationId: current.id })
      options.onChanged?.()
      await load()
    } catch (value) {
      error.value = errorMessage(value, '提交失败')
    } finally {
      acting.value = false
    }
  }

  function dispose(): void {
    disposed = true
    if (searchTimer) clearTimeout(searchTimer)
    if (pollingTimer) clearInterval(pollingTimer)
    searchTimer = null
    pollingTimer = null
  }

  if (options.registerLifecycle !== false) {
    onMounted(() => {
      disposed = false
      void load()
      pollingTimer = setInterval(() => {
        if (isAnalyzing.value || isWaitingAnalysis.value) void load({ quiet: true })
      }, options.pollIntervalMs ?? 2500)
    })
    onUnmounted(dispose)
  }

  return {
    initialization,
    downloadConcurrency,
    queueDepth,
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
    drawerItem,
    searchResults,
    isAnalyzing,
    isWaitingAnalysis,
    isEditable,
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
    toggle,
    togglePage,
    onSearch,
    clearFilters,
    changePage,
    openDrawer,
    searchPlex,
    chooseCandidate,
    commit,
    dispose,
  }
}
