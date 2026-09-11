import type { SourceRequestsResult, SourceRequestResult } from '~~/server/lib/sync/source-requests'
import type { PlaylistSource } from '~~/server/lib/playlist/types'
import { useDragReorder } from '~~/composables/useDragReorder'
import { getCopyrightCount, getActionableFailureCount, getSourceDisplayName } from '~~/composables/useSyncSourcePresentation'
import { countActiveFilters } from '~~/composables/useFilterQuery'
import { createLatestAsyncGuard, useDebounceFn, useRafThrottleFn } from '~~/composables/useTiming'
import { useFeedback } from '~~/composables/useFeedback'

export function useSyncSourcesPage() {
  const api = useApi()
  const route = useRoute()
  const router = useRouter()
  const feedback = useFeedback()
  const { error: sourceRequestError, requestState, syncingSourceId, syncSource: triggerSourceSync } = useSourceSync()
  const { state: globalSyncState } = useSync()
  const sources = ref<PlaylistSource[]>([])
  const allSources = ref<PlaylistSource[]>([])
  const loading = ref(false)
  const loadError = ref('')
  const sourceFetchGuard = createLatestAsyncGuard()
  const togglingId = ref<string | null>(null)

  type SourceStatusFilter = '' | 'idle' | 'success' | 'partial' | 'failed'
  type EnabledFilter = '' | 'enabled' | 'disabled'
  type SubscribedFilter = '' | 'subscribed'
  type PlexTargetFilter = '' | 'bound' | 'unbound'
  type IssueFilter = '' | 'failures' | 'copyright'
  type SourceFilterChipKey = 'search' | 'type' | 'enabled' | 'subscribed' | 'plexTarget' | 'status' | 'issue'
  type SourceBatchAction = 'enable' | 'disable' | 'delete' | 'sync'

  const filterType = ref<'playlist' | 'album'>('playlist')
  const sourceSearch = ref('')
  const enabledFilter = ref<EnabledFilter>('')
  const subscribedFilter = ref<SubscribedFilter>('')
  const plexTargetFilter = ref<PlexTargetFilter>('')
  const statusFilter = ref<SourceStatusFilter>('')
  const issueFilter = ref<IssueFilter>('')
  const draftEnabledFilter = ref<EnabledFilter>('')
  const draftSubscribedFilter = ref<SubscribedFilter>('')
  const draftPlexTargetFilter = ref<PlexTargetFilter>('')
  const draftStatusFilter = ref<SourceStatusFilter>('')
  const draftIssueFilter = ref<IssueFilter>('')
  const sourceFilters = [
    { key: 'playlist' as const, label: '歌单' },
    { key: 'album' as const, label: '已保存专辑' },
  ]
  const statusFilterOptions: Array<{ value: SourceStatusFilter; label: string }> = [
    { value: '', label: '全部' },
    { value: 'success', label: '成功' },
    { value: 'partial', label: '部分失败' },
    { value: 'failed', label: '失败' },
    { value: 'idle', label: '未同步' },
  ]
  const filteredSources = computed(() => sources.value)
  const playlistSourceCount = computed(() => allSources.value.filter(s => s.type === 'playlist').length)
  const albumSourceCount = computed(() => allSources.value.filter(s => s.type === 'album').length)
  const sourcePageTabs = computed(() => sourceFilters.map(tab => ({
    ...tab,
    count: tab.key === 'playlist' ? playlistSourceCount.value : albumSourceCount.value,
  })))
  const sourceActiveCount = computed(() => countActiveFilters({
    search: sourceSearch.value,
    type: filterType.value === 'playlist' ? '' : filterType.value,
    enabled: enabledFilter.value,
    subscribed: subscribedFilter.value,
    plexTarget: plexTargetFilter.value,
    status: statusFilter.value,
    issue: issueFilter.value,
  }))
  const advancedFilterCount = computed(() => countActiveFilters({
    enabled: enabledFilter.value,
    subscribed: subscribedFilter.value,
    plexTarget: plexTargetFilter.value,
    status: statusFilter.value,
    issue: issueFilter.value,
  }))
  const sourceCanClear = computed(() => sourceActiveCount.value > 0)
  const canDragReorder = computed(() => filterType.value === 'playlist' && sourceActiveCount.value === 0)
  const selectedSourceIds = ref(new Set<string>())
  const selectedSources = computed(() => {
    const ids = selectedSourceIds.value
    return filteredSources.value.filter(source => ids.has(source.id))
  })
  const selectedCount = computed(() => selectedSourceIds.value.size)
  const selectedHasAlbum = computed(() => selectedSources.value.some(source => source.type === 'album'))
  const selectedHasDisabledPlaylist = computed(() => selectedSources.value.some(source => source.type === 'playlist' && !source.enabled))
  const canBatchToggleSelected = computed(() => selectedCount.value > 0 && !selectedHasAlbum.value)
  const canBatchSyncSelected = computed(() =>
    selectedCount.value > 0
    && !selectedHasAlbum.value
    && !selectedHasDisabledPlaylist.value
    && !isAnySyncing.value
    && !batchLoading.value,
  )
  const allVisibleSelected = computed(() => filteredSources.value.length > 0 && filteredSources.value.every(source => selectedSourceIds.value.has(source.id)))
  const someVisibleSelected = computed(() =>
    filteredSources.value.some(source => selectedSourceIds.value.has(source.id)) && !allVisibleSelected.value,
  )
  const sourceFilterChips = computed<Array<{ key: SourceFilterChipKey; label: string }>>(() => {
    const chips: Array<{ key: SourceFilterChipKey; label: string }> = []
    const search = sourceSearch.value.trim()
    if (search) chips.push({ key: 'search', label: `搜索：${search}` })
    if (filterType.value === 'album') chips.push({ key: 'type', label: '类型：已保存专辑' })
    if (enabledFilter.value) chips.push({ key: 'enabled', label: `状态：${enabledFilter.value === 'enabled' ? '已启用' : '已禁用'}` })
    if (statusFilter.value) chips.push({ key: 'status', label: `结果：${statusFilterOptions.find(option => option.value === statusFilter.value)?.label ?? statusFilter.value}` })
    if (subscribedFilter.value) chips.push({ key: 'subscribed', label: '网易云：收藏的歌单' })
    if (plexTargetFilter.value) chips.push({ key: 'plexTarget', label: plexTargetFilter.value === 'bound' ? 'Plex：已绑定目标' : 'Plex：未绑定目标' })
    if (issueFilter.value) chips.push({ key: 'issue', label: `特殊：${issueFilter.value === 'failures' ? '有待处理异常' : '版权受限'}` })
    return chips
  })

  function queryString(key: string): string {
    const value = route.query[key]
    if (Array.isArray(value)) return value[0] ?? ''
    return typeof value === 'string' ? value : ''
  }

  function restoreSourceFiltersFromRoute() {
    sourceSearch.value = queryString('search')
    filterType.value = queryString('type') === 'album' ? 'album' : 'playlist'
    enabledFilter.value = ['enabled', 'disabled'].includes(queryString('enabled')) ? queryString('enabled') as EnabledFilter : ''
    subscribedFilter.value = queryString('subscribed') === 'subscribed' ? 'subscribed' : ''
    plexTargetFilter.value = ['bound', 'unbound'].includes(queryString('plexTarget')) ? queryString('plexTarget') as PlexTargetFilter : ''
    statusFilter.value = ['idle', 'success', 'partial', 'failed'].includes(queryString('status')) ? queryString('status') as SourceStatusFilter : ''
    issueFilter.value = ['failures', 'copyright'].includes(queryString('issue')) ? queryString('issue') as IssueFilter : ''
  }

  function syncSourceFilterQuery() {
    router.replace({
      query: {
        ...route.query,
        search: sourceSearch.value || undefined,
        type: filterType.value === 'playlist' ? undefined : filterType.value,
        enabled: enabledFilter.value || undefined,
        subscribed: subscribedFilter.value || undefined,
        plexTarget: plexTargetFilter.value || undefined,
        status: statusFilter.value || undefined,
        issue: issueFilter.value || undefined,
      },
    })
  }

  function buildSourceParams(): Record<string, string> {
    const params: Record<string, string> = { type: filterType.value }
    const search = sourceSearch.value.trim()
    if (search) params.search = search
    if (enabledFilter.value) params.enabled = enabledFilter.value === 'enabled' ? '1' : '0'
    if (subscribedFilter.value === 'subscribed') params.subscribed = '1'
    if (plexTargetFilter.value) params.hasPlexTarget = plexTargetFilter.value === 'bound' ? '1' : '0'
    if (statusFilter.value) params.lastStatus = statusFilter.value
    if (issueFilter.value === 'failures') params.hasFailures = '1'
    if (issueFilter.value === 'copyright') params.hasCopyright = '1'
    return params
  }

  async function applySourceFilters() {
    sourceSearchDebounce.cancel()
    syncSourceFilterQuery()
    await fetchSources()
  }

  const sourceSearchDebounce = useDebounceFn(() => { void applySourceFilters() }, 400)
  function onSourceSearchInput(value: string) {
    sourceSearch.value = value
    sourceSearchDebounce.run()
  }

  function setSourceType(type: 'playlist' | 'album') {
    filterType.value = type
    void applySourceFilters()
  }

  function onSourceTabChange(type: string) {
    if (type === 'playlist' || type === 'album') setSourceType(type)
  }

  function prepareDraftFilters() {
    draftEnabledFilter.value = enabledFilter.value
    draftSubscribedFilter.value = subscribedFilter.value
    draftPlexTargetFilter.value = plexTargetFilter.value
    draftStatusFilter.value = statusFilter.value
    draftIssueFilter.value = issueFilter.value
  }

  function resetDraftFilters() {
    draftEnabledFilter.value = ''
    draftSubscribedFilter.value = ''
    draftPlexTargetFilter.value = ''
    draftStatusFilter.value = ''
    draftIssueFilter.value = ''
  }

  function applyDraftFilters(close?: () => void) {
    enabledFilter.value = draftEnabledFilter.value
    subscribedFilter.value = draftSubscribedFilter.value
    plexTargetFilter.value = draftPlexTargetFilter.value
    statusFilter.value = draftStatusFilter.value
    issueFilter.value = draftIssueFilter.value
    close?.()
    void applySourceFilters()
  }

  function clearSourceFilters() {
    sourceSearch.value = ''
    filterType.value = 'playlist'
    enabledFilter.value = ''
    subscribedFilter.value = ''
    plexTargetFilter.value = ''
    statusFilter.value = ''
    issueFilter.value = ''
    resetDraftFilters()
    void applySourceFilters()
  }

  function removeSourceFilter(key: SourceFilterChipKey) {
    if (key === 'search') sourceSearch.value = ''
    if (key === 'type') filterType.value = 'playlist'
    if (key === 'enabled') enabledFilter.value = ''
    if (key === 'subscribed') subscribedFilter.value = ''
    if (key === 'plexTarget') plexTargetFilter.value = ''
    if (key === 'status') statusFilter.value = ''
    if (key === 'issue') issueFilter.value = ''
    void applySourceFilters()
  }

  async function refreshSources() {
    await fetchSources()
    await fetchSummarySources()
  }

  watch(sourceRequestError, value => { if (value) feedback.error('来源请求失败', value) })
  watch(() => requestState.value?.status, () => { void refreshSources() })

  // Summary computed
  const totalSourceCount = computed(() => allSources.value.length)
  const enabledCount = computed(() => allSources.value.filter(s => s.type === 'playlist' && s.enabled).length)
  const totalActionableFailures = computed(() => allSources.value.reduce((sum, s) => sum + getActionableFailureCount(s), 0))
  const totalCopyright = computed(() => allSources.value.reduce((sum, s) => sum + getCopyrightCount(s), 0))
  const advancedFilterLabel = computed(() => '筛选')

  // Add dialogs
  const showAdd = ref(false)

  // Drag & drop — only enabled in 歌单 view; wrapper handlers map filtered indices to sources indices
  const { dragOverIdx, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd } = useDragReorder(
    sources,
    async (orderedIds) => { await api.put('/playlist-sources/reorder', { orderedIds }) },
    (s) => s.id,
  )
  const throttledDragOver = useRafThrottleFn(onDragOver)

  // Wrap drag handlers to work with filteredSources indices → sources indices
  function onFilteredDragStart(idx: number, e: DragEvent) {
    if (!canDragReorder.value) return
    const item = filteredSources.value[idx]
    if (!item) return
    const realIdx = sources.value.findIndex(s => s.id === item!.id)
    if (realIdx >= 0) onDragStart(realIdx, e)
  }
  function onFilteredDragOver(idx: number) {
    if (!canDragReorder.value) return
    const item = filteredSources.value[idx]
    if (!item) return
    const realIdx = sources.value.findIndex(s => s.id === item!.id)
    if (realIdx >= 0) throttledDragOver.run(realIdx)
  }
  function onFilteredDrop(idx: number) {
    if (!canDragReorder.value) return
    const item = filteredSources.value[idx]
    if (!item) return
    const realIdx = sources.value.findIndex(s => s.id === item!.id)
    if (realIdx >= 0) onDrop(realIdx)
  }

  function pruneSelectionToVisible() {
    const visibleIds = new Set(filteredSources.value.map(source => source.id))
    const next = new Set([...selectedSourceIds.value].filter(id => visibleIds.has(id)))
    if (next.size !== selectedSourceIds.value.size) selectedSourceIds.value = next
  }

  function toggleSourceSelection(id: string) {
    const next = new Set(selectedSourceIds.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selectedSourceIds.value = next
  }

  function toggleSelectAllVisible() {
    const next = new Set(selectedSourceIds.value)
    if (allVisibleSelected.value) {
      for (const source of filteredSources.value) next.delete(source.id)
    } else {
      for (const source of filteredSources.value) next.add(source.id)
    }
    selectedSourceIds.value = next
  }

  function clearSelection() {
    selectedSourceIds.value = new Set()
  }

  function openAddPlaylist() { showAdd.value = true }
  function onPlaylistCreated(count = 1) {
    filterType.value = 'playlist'
    void refreshSources()
    feedback.success(`已添加 ${count} 个歌单同步源`)
  }
  function onAlbumCreated(count = 1) {
    filterType.value = 'album'
    void refreshSources()
    feedback.success(`已添加 ${count} 个专辑源`)
  }

  async function fetchSummarySources() {
    try {
      allSources.value = await api.get<PlaylistSource[]>('/playlist-sources')
    } catch { /* keep previous summary */ }
  }

  async function fetchSources() {
    const token = sourceFetchGuard.next()
    loading.value = true
    loadError.value = ''
    try {
      const items = await api.get<PlaylistSource[]>('/playlist-sources', buildSourceParams())
      if (!sourceFetchGuard.isLatest(token)) return
      sources.value = items
      pruneSelectionToVisible()
    } catch (err) { if (sourceFetchGuard.isLatest(token)) loadError.value = err instanceof Error ? err.message : '收藏读取失败，请重试' }
    finally {
      if (sourceFetchGuard.isLatest(token)) loading.value = false
    }
  }

  async function toggleEnabled(s: PlaylistSource) {
    togglingId.value = s.id
    const prev = s.enabled
    const next = !prev
    const label = getSourceDisplayName(s)
    s.enabled = next
    try {
      await api.put(`/playlist-sources/${s.id}`, { enabled: next })
      await fetchSummarySources()
      feedback.success(next ? '同步源已启用' : '同步源已禁用', label)
    } catch (err) {
      s.enabled = prev
      feedback.error(next ? '启用同步源失败' : '禁用同步源失败', err instanceof Error ? err.message : '请稍后重试')
    } finally {
      togglingId.value = null
    }
  }

  const isAnySyncing = computed(() => syncingSourceId.value !== null || globalSyncState.value?.isRunning === true)

  async function syncSource(s: PlaylistSource, full = false) {
    try {
      const result = await triggerSourceSync(s.id, { mode: full ? 'full' : 'normal' })
      feedback.success(result.results[0]?.message || '请求已接受', getSourceDisplayName(s))
      await refreshSources()
    } catch (err) {
      syncingSourceId.value = null
      feedback.error('触发同步失败', err instanceof Error ? err.message : '请稍后重试')
    }
  }

  const batchLoading = ref(false)
  const sourceRequestResults = ref<SourceRequestResult[]>([])
  const batchToggling = ref(false)

  async function runSelectedBatch(action: Exclude<SourceBatchAction, 'delete'>) {
    const ids = [...selectedSourceIds.value]
    if (ids.length === 0) return
    if (action === 'sync') { batchLoading.value = true; sourceRequestResults.value = [] }
    else batchToggling.value = true
    try {
      const result = await api.post<SourceRequestsResult & { count: number; action: SourceBatchAction }>('/playlist-sources/batch', { action, ids })
      if (action !== 'sync') {
        feedback.success(action === 'enable' ? `已启用 ${result.count} 个同步源` : `已禁用 ${result.count} 个同步源`)
        clearSelection()
        await refreshSources()
      } else {
        sourceRequestResults.value = result.results
        const blocked = result.results.find(item => item.status === 'busy' || item.status === 'failed')
        if (blocked) throw new Error(blocked.message)
        const waiting = result.results.filter(item => item.status === 'awaiting_review').length
        feedback.success(`已接受 ${result.count} 个来源请求，${waiting} 个来源等待确认`)
        batchLoading.value = false
        await refreshSources()
      }
    } catch (error) {
      if (action === 'sync') batchLoading.value = false
      feedback.error('批量操作失败', error instanceof Error ? error.message : '请稍后重试')
    } finally {
      if (action === 'sync') batchLoading.value = false
      if (action !== 'sync') batchToggling.value = false
    }
  }

  watch(() => globalSyncState.value?.isRunning, (running, previous) => {
    if (!running && previous) void refreshSources()
  })

  let unsubscribe: (() => void) | null = null
  let resumeUnsubscribe: (() => void) | null = null
  onMounted(() => {
    restoreSourceFiltersFromRoute()
    if (route.query.add === '1') { showAdd.value = true; void router.replace({ query: { ...route.query, add: undefined } }) }
    void refreshSources()
    unsubscribe = sseSubscribe('stage-change', data => { if (data.stage === 'idle') void refreshSources() })
    resumeUnsubscribe = sseSubscribe('resync', () => { void refreshSources() })
  })
  onUnmounted(() => { unsubscribe?.(); resumeUnsubscribe?.(); sourceSearchDebounce.cancel() })

  return {
  loadError, sourceRequestResults, advancedFilterCount, advancedFilterLabel, allSources, allVisibleSelected, applyDraftFilters, batchLoading, batchToggling, canBatchSyncSelected, canBatchToggleSelected, canDragReorder, clearSourceFilters, draftEnabledFilter, draftIssueFilter, draftStatusFilter, draftSubscribedFilter, draftPlexTargetFilter, dragOverIdx, enabledCount, filteredSources, filterType, isAnySyncing, loading, onAlbumCreated, onDragEnd, onDragLeave, onFilteredDragOver, onFilteredDragStart, onFilteredDrop, onPlaylistCreated, onSourceSearchInput, onSourceTabChange, openAddPlaylist, prepareDraftFilters, refreshSources, removeSourceFilter, resetDraftFilters, runSelectedBatch, selectedCount, selectedSourceIds, showAdd, someVisibleSelected, sourceCanClear, sourceFilterChips, sourcePageTabs, sourceSearch, statusFilterOptions, syncingSourceId, syncSource, toggleEnabled, toggleSelectAllVisible, toggleSourceSelection, togglingId, totalActionableFailures, totalCopyright, totalSourceCount
  }
}
