import type { PlaylistSource } from '~~/server/lib/playlist/types'
import { useDragReorder } from '~~/composables/useDragReorder'
import {
  formatSyncSourceRelativeTime,
  getCopyrightCount,
  getIgnoredFailureCount,
  getIssueCount,
  getPlexTargetName,
  getPlexTargetHint,
  getSourceDisplayName,
  getSourceMetaLabel,
  getSourceOriginName,
  getSourceStateLabel,
  getSourceStateTone,
  getIssueSummaryLabel,
  getSyncResultLabel,
  getSyncResultTone,
} from '~~/composables/useSyncSourcePresentation'
import { countActiveFilters } from '~~/composables/useFilterQuery'
import { createLatestAsyncGuard, useDebounceFn, useRafThrottleFn } from '~~/composables/useTiming'
import { useFeedback } from '~~/composables/useFeedback'

export function useSyncSourcesPage() {
  const api = useApi()
  const route = useRoute()
  const router = useRouter()
  const feedback = useFeedback()
  const { syncingSourceId, syncSource: triggerSourceSync } = useSourceSync()
  const { state: globalSyncState } = useSync()
  const sources = ref<PlaylistSource[]>([])
  const allSources = ref<PlaylistSource[]>([])
  const loading = ref(false)
  const sourceFetchGuard = createLatestAsyncGuard()
  const togglingId = ref<string | null>(null)
  const forceFullId = ref<string | null>(null)
  const rebuildSyncId = ref<string | null>(null)
  const repairingSourceId = ref<string | null>(null)
  const repairProgress = ref<Record<string, { processed: number; total: number }>>({})

  type SourceStatusFilter = '' | 'idle' | 'success' | 'partial' | 'failed'
  type EnabledFilter = '' | 'enabled' | 'disabled'
  type SubscribedFilter = '' | 'subscribed'
  type IssueFilter = '' | 'ignored' | 'copyright'
  type SourceFilterChipKey = 'search' | 'type' | 'enabled' | 'subscribed' | 'status' | 'issue'
  type SourceBatchAction = 'enable' | 'disable' | 'delete' | 'sync'

  const filterType = ref<'playlist' | 'album'>('playlist')
  const sourceSearch = ref('')
  const enabledFilter = ref<EnabledFilter>('')
  const subscribedFilter = ref<SubscribedFilter>('')
  const statusFilter = ref<SourceStatusFilter>('')
  const issueFilter = ref<IssueFilter>('')
  const draftEnabledFilter = ref<EnabledFilter>('')
  const draftSubscribedFilter = ref<SubscribedFilter>('')
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
    status: statusFilter.value,
    issue: issueFilter.value,
  }))
  const advancedFilterCount = computed(() => countActiveFilters({
    enabled: enabledFilter.value,
    subscribed: subscribedFilter.value,
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
    if (subscribedFilter.value) chips.push({ key: 'subscribed', label: '特殊：已绑定目标' })
    if (issueFilter.value) chips.push({ key: 'issue', label: `特殊：${issueFilter.value === 'ignored' ? '有忽略' : '版权受限'}` })
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
    statusFilter.value = ['idle', 'success', 'partial', 'failed'].includes(queryString('status')) ? queryString('status') as SourceStatusFilter : ''
    issueFilter.value = ['ignored', 'copyright'].includes(queryString('issue')) ? queryString('issue') as IssueFilter : ''
  }

  function syncSourceFilterQuery() {
    router.replace({
      query: {
        ...route.query,
        search: sourceSearch.value || undefined,
        type: filterType.value === 'playlist' ? undefined : filterType.value,
        enabled: enabledFilter.value || undefined,
        subscribed: subscribedFilter.value || undefined,
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
    if (statusFilter.value) params.lastStatus = statusFilter.value
    if (issueFilter.value === 'ignored') params.hasIgnored = '1'
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
    draftStatusFilter.value = statusFilter.value
    draftIssueFilter.value = issueFilter.value
  }

  function resetDraftFilters() {
    draftEnabledFilter.value = ''
    draftSubscribedFilter.value = ''
    draftStatusFilter.value = ''
    draftIssueFilter.value = ''
  }

  function applyDraftFilters(close?: () => void) {
    enabledFilter.value = draftEnabledFilter.value
    subscribedFilter.value = draftSubscribedFilter.value
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
    if (key === 'status') statusFilter.value = ''
    if (key === 'issue') issueFilter.value = ''
    void applySourceFilters()
  }

  async function refreshSources() {
    await fetchSources()
    await fetchSummarySources()
  }

  // Summary computed
  const totalSourceCount = computed(() => allSources.value.length)
  const enabledCount = computed(() => allSources.value.filter(s => s.type === 'playlist' && s.enabled).length)
  const lastSyncTime = computed(() => {
    const times = allSources.value.filter(s => s.lastSyncedAt).map(s => new Date(s.lastSyncedAt!).getTime())
    if (times.length === 0) return ''
    const latest = new Date(Math.max(...times))
    return formatRelative(latest.toISOString())
  })
  const totalIgnored = computed(() => allSources.value.reduce((sum, s) => sum + sourceIgnoredCount(s), 0))
  const totalCopyright = computed(() => allSources.value.reduce((sum, s) => sum + sourceCopyrightCount(s), 0))
  const advancedFilterLabel = computed(() => advancedFilterCount.value > 0 ? '筛选' : '高级筛选')

  // Add dialogs
  const showAdd = ref(false)
  // Edit
  const editTarget = ref<PlaylistSource | null>(null)
  const hoverCard = ref<{ source: PlaylistSource; top: number; left: number } | null>(null)
  const tableShellRef = ref<HTMLElement | null>(null)
  const tableShellWidth = ref(0)
  let hoverHideTimer: ReturnType<typeof setTimeout> | null = null
  let tableShellResizeObserver: ResizeObserver | null = null

  // Drag & drop — only enabled in 歌单 view; wrapper handlers map filtered indices to sources indices
  const { dragIdx, dragOverIdx, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd } = useDragReorder(
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

  const confirmDelete = ref<PlaylistSource | null>(null)
  const confirmRebuild = ref<PlaylistSource | null>(null)
  const confirmBatchDelete = ref(false)

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
  function openEdit(s: PlaylistSource) { editTarget.value = s }
  async function onSourceSaved() {
    await refreshSources()
    feedback.success('同步源已保存')
  }

  // More menu
  const moreMenuId = ref<string | null>(null)
  function toggleMoreMenu(id: string) {
    moreMenuId.value = moreMenuId.value === id ? null : id
  }

  type DesktopActionDensity = 'compact' | 'comfortable' | 'wide' | 'expanded'

  const desktopActionDensity = computed<DesktopActionDensity>(() => {
    const width = tableShellWidth.value || 0
    if (width >= 1780) return 'expanded'
    if (width >= 1540) return 'wide'
    if (width >= 1320) return 'comfortable'
    return 'compact'
  })

  const showInlineEditAction = computed(() =>
    desktopActionDensity.value === 'comfortable'
    || desktopActionDensity.value === 'wide'
    || desktopActionDensity.value === 'expanded',
  )

  const showInlineRepairAction = computed(() =>
    desktopActionDensity.value === 'wide'
    || desktopActionDensity.value === 'expanded',
  )

  function showInlineFullSyncAction(source: PlaylistSource): boolean {
    return source.type === 'playlist' && desktopActionDensity.value === 'expanded'
  }

  function updateTableShellWidth() {
    tableShellWidth.value = tableShellRef.value?.clientWidth ?? window.innerWidth
  }
  const updateTableShellWidthOnFrame = useRafThrottleFn(updateTableShellWidth)

  // Expand songs
  const expandedId = ref<string | null>(null)
  const expandedSongs = ref<Array<{ id: string; songName: string; artist: string; status: string }>>([])
  const expandedLoading = ref(false)

  async function toggleExpand(sourceId: string) {
    if (expandedId.value === sourceId) { expandedId.value = null; return }
    expandedId.value = sourceId
    expandedLoading.value = true
    try { expandedSongs.value = await api.get(`/playlist-sources/${sourceId}/songs`) } catch { expandedSongs.value = [] }
    finally { expandedLoading.value = false }
  }

  function songStatusDot(status: string): string {
    switch (status) {
      case 'success': return 'bg-success'
      case 'failed_download': case 'failed_tags': return 'bg-danger'
      case 'failed_plex_match': case 'failed_plex_insert': return 'bg-warning'
      case 'copyright_restricted': case 'ignored_failure': return 'bg-ignored'
      case 'skipped_existing': return 'bg-existing'
      default: return 'bg-muted-deep'
    }
  }

  function sourceDisplayName(source: PlaylistSource): string {
    return getSourceDisplayName(source)
  }

  function sourceOriginName(source: PlaylistSource): string {
    return getSourceOriginName(source)
  }

  function sourceMetaLabel(source: PlaylistSource): string {
    return getSourceMetaLabel(source)
  }

  function plexTargetName(source: PlaylistSource): string {
    return getPlexTargetName(source)
  }

  function plexTargetHint(source: PlaylistSource): string {
    return getPlexTargetHint(source)
  }

  function sourceCoverSrc(url: string): string {
    if (!url) return ''
    return url.includes('?') ? `${url}&param=80y80` : `${url}?param=80y80`
  }

  function sourceIgnoredCount(source: PlaylistSource): number {
    return getIgnoredFailureCount(source)
  }

  function sourceCopyrightCount(source: PlaylistSource): number {
    return getCopyrightCount(source)
  }

  function sourceIssueCount(source: PlaylistSource): number {
    return getIssueCount(source)
  }

  function sourceIssueSummary(source: PlaylistSource): string {
    return getIssueSummaryLabel(source)
  }

  function sourceHoverOrigin(source: PlaylistSource): string {
    const origin = sourceOriginName(source)
    return origin !== sourceDisplayName(source) ? origin : ''
  }

  function sourceStateLabel(source: PlaylistSource): string {
    return getSourceStateLabel(source)
  }

  function sourceStateClass(source: PlaylistSource): string {
    const tone = getSourceStateTone(source)
    return `sync-pill--${tone}`
  }

  function syncResultLabel(source: PlaylistSource): string {
    return getSyncResultLabel(source)
  }

  function rebuildActionLabel(source: PlaylistSource): string {
    return source.type === 'album' ? '重建匹配并下载' : '重建匹配并同步'
  }

  function syncResultTextClass(source: PlaylistSource): string {
    const tone = repairingSourceId.value === source.id ? 'accent' : getSyncResultTone(source)
    return `sync-table__result-label--${tone}`
  }

  function syncResultDotClass(source: PlaylistSource): string {
    if (repairingSourceId.value === source.id) return 'sync-result-dot--accent'
    switch (getSyncResultTone(source)) {
      case 'success':
        return 'sync-result-dot--success'
      case 'warning':
        return 'sync-result-dot--warning'
      case 'danger':
        return 'sync-result-dot--danger'
      default:
        return 'sync-result-dot--neutral'
    }
  }

  function clearHoverHideTimer() {
    if (hoverHideTimer) {
      clearTimeout(hoverHideTimer)
      hoverHideTimer = null
    }
  }

  function showSourceHover(source: PlaylistSource, event: MouseEvent | FocusEvent) {
    clearHoverHideTimer()
    const target = event.currentTarget
    if (!(target instanceof HTMLElement)) return
    const rect = target.getBoundingClientRect()
    const width = 22 * 16
    const height = 12.5 * 16
    const gutter = 16
    let left = rect.left
    let top = rect.bottom + 12

    if (left + width > window.innerWidth - gutter) {
      left = Math.max(gutter, window.innerWidth - width - gutter)
    }

    if (top + height > window.innerHeight - gutter) {
      top = Math.max(gutter, rect.top - height - 12)
    }

    hoverCard.value = { source, top, left }
  }

  function scheduleHideSourceHover() {
    clearHoverHideTimer()
    hoverHideTimer = setTimeout(() => {
      hoverCard.value = null
    }, 90)
  }

  async function clearIgnored(s: PlaylistSource) {
    try {
      await api.put(`/playlist-sources/${s.id}`, { ignoredFailureIds: null, copyrightRestrictedIds: null })
      await refreshSources()
      feedback.success('忽略记录已清除')
    } catch (err) {
      feedback.error('清除忽略记录失败', err instanceof Error ? err.message : '请稍后重试')
    }
  }

  async function fetchSummarySources() {
    try {
      allSources.value = await api.get<PlaylistSource[]>('/playlist-sources')
    } catch { /* keep previous summary */ }
  }

  async function fetchSources() {
    const token = sourceFetchGuard.next()
    loading.value = true
    try {
      const items = await api.get<PlaylistSource[]>('/playlist-sources', buildSourceParams())
      if (!sourceFetchGuard.isLatest(token)) return
      sources.value = items
      pruneSelectionToVisible()
    } catch { /* ignore */ }
    finally {
      if (sourceFetchGuard.isLatest(token)) loading.value = false
    }
  }

  async function toggleEnabled(s: PlaylistSource) {
    togglingId.value = s.id
    const prev = s.enabled
    const next = !prev
    const label = sourceDisplayName(s)
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

  async function handleDelete() {
    if (!confirmDelete.value) return
    const source = confirmDelete.value
    const id = source.id
    confirmDelete.value = null
    try {
      await api.del(`/playlist-sources/${id}`)
      await refreshSources()
      feedback.success('同步源已删除', sourceDisplayName(source))
    } catch (err) {
      feedback.error('删除同步源失败', err instanceof Error ? err.message : '请稍后重试')
    }
  }

  const isAnySyncing = computed(() =>
    syncingSourceId.value !== null
    || forceFullId.value !== null
    || rebuildSyncId.value !== null
    || repairingSourceId.value !== null,
  )

  function openRebuildConfirm(source: PlaylistSource) {
    confirmRebuild.value = source
  }

  async function syncSource(s: PlaylistSource, forceFull = false) {
    try {
      if (forceFull) {
        if (s.type === 'album') syncingSourceId.value = s.id
        else forceFullId.value = s.id
        await api.post(`/playlist-sources/${s.id}/sync`, { forceFull: true })
      } else {
        await triggerSourceSync(s.id)
      }
      feedback.success(sourceSyncTriggerTitle(s, forceFull), sourceDisplayName(s))
    } catch (err) {
      forceFullId.value = null
      syncingSourceId.value = null
      feedback.error('触发同步失败', err instanceof Error ? err.message : '请稍后重试')
    }
  }

  async function handleRebuildSync() {
    if (!confirmRebuild.value) return
    const source = confirmRebuild.value
    confirmRebuild.value = null
    rebuildSyncId.value = source.id
    try {
      await api.post(`/playlist-sources/${source.id}/sync`, { forceFull: true, rebuildMatch: true })
      feedback.success(source.type === 'album' ? '重建匹配并下载已触发' : '重建匹配并同步已触发', sourceDisplayName(source))
    } catch (err) {
      rebuildSyncId.value = null
      feedback.error('触发重建失败', err instanceof Error ? err.message : '请稍后重试')
    }
  }

  function sourceSyncTriggerTitle(source: PlaylistSource, forceFull: boolean): string {
    if (source.type === 'album') return '专辑下载已触发'
    return forceFull ? '全量同步已触发' : '同步已触发'
  }

  const batchLoading = ref(false)
  const batchToggling = ref(false)
  const batchDeleting = ref(false)

  async function runSelectedBatch(action: Exclude<SourceBatchAction, 'delete'>) {
    const ids = [...selectedSourceIds.value]
    if (ids.length === 0) return
    if (action === 'sync') batchLoading.value = true
    else batchToggling.value = true
    try {
      const result = await api.post<{ count: number; action: SourceBatchAction }>('/playlist-sources/batch', { action, ids })
      if (action !== 'sync') {
        feedback.success(action === 'enable' ? `已启用 ${result.count} 个同步源` : `已禁用 ${result.count} 个同步源`)
        clearSelection()
        await refreshSources()
      } else {
        feedback.success(`已触发 ${result.count} 个同步源同步`)
      }
    } catch {
      if (action === 'sync') batchLoading.value = false
      feedback.error('批量操作失败')
    } finally {
      if (action !== 'sync') batchToggling.value = false
    }
  }

  // Track global sync via composable for batch button loading state
  watch(() => globalSyncState.value?.isRunning, (running) => {
    if (!running && batchLoading.value) {
      batchLoading.value = false
      feedback.success('批量同步已完成')
      clearSelection()
    }
  })

  function openBatchDeleteConfirm() {
    if (selectedCount.value === 0) return
    confirmBatchDelete.value = true
  }

  async function handleBatchDelete() {
    const ids = [...selectedSourceIds.value]
    if (ids.length === 0) return
    confirmBatchDelete.value = false
    batchDeleting.value = true
    try {
      const result = await api.post<{ count: number }>('/playlist-sources/batch', { action: 'delete', ids })
      feedback.success(`已删除 ${result.count} 个来源`)
      clearSelection()
      await refreshSources()
    } catch {
      feedback.error('批量删除失败')
    } finally {
      batchDeleting.value = false
    }
  }

  async function repairSource(s: PlaylistSource) {
    if (repairingSourceId.value) return
    repairingSourceId.value = s.id
    try {
      await api.post(`/playlist-sources/${s.id}/repair`)
      feedback.success('补全任务已触发', sourceDisplayName(s))
    } catch (err) {
      repairingSourceId.value = null
      feedback.error('触发补全失败', err instanceof Error ? err.message : '请稍后重试')
    }
  }

  // SSE: clear spinners when sync finishes
  const sseUnsubs: Array<() => void> = []
  const hideHoverOnFrame = useRafThrottleFn(() => { hoverCard.value = null })
  const handleHoverInvalidation = () => hideHoverOnFrame.run()
  const handleTableShellResize = () => updateTableShellWidthOnFrame.run()

  onMounted(() => {
    restoreSourceFiltersFromRoute()
    void refreshSources()
    updateTableShellWidth()

    window.addEventListener('scroll', handleHoverInvalidation, true)
    window.addEventListener('resize', handleHoverInvalidation)
    window.addEventListener('resize', handleTableShellResize)

    if (typeof ResizeObserver !== 'undefined' && tableShellRef.value) {
      tableShellResizeObserver = new ResizeObserver(() => updateTableShellWidthOnFrame.run())
      tableShellResizeObserver.observe(tableShellRef.value)
    }

    sseUnsubs.push(sseSubscribe('stage-change', (data) => {
      const stage = data.stage as string
      if (stage === 'idle') {
        forceFullId.value = null
        rebuildSyncId.value = null
        repairingSourceId.value = null
        repairProgress.value = {}
        void refreshSources()
      }
    }))
    sseUnsubs.push(sseSubscribe('repair-progress', (data) => {
      const { sourceId, processed, totalSongs } = data as Record<string, unknown>
      if (sourceId && typeof processed === 'number') {
        repairProgress.value = { ...repairProgress.value, [sourceId as string]: { processed, total: totalSongs as number } }
      }
    }))
    sseUnsubs.push(() => window.removeEventListener('scroll', handleHoverInvalidation, true))
    sseUnsubs.push(() => window.removeEventListener('resize', handleHoverInvalidation))
    sseUnsubs.push(() => window.removeEventListener('resize', handleTableShellResize))
  })

  onUnmounted(() => {
    clearHoverHideTimer()
    tableShellResizeObserver?.disconnect()
    for (const unsub of sseUnsubs) unsub()
  })

  function formatRelative(iso: string): string {
    return formatSyncSourceRelativeTime(iso)
  }

  return {
    advancedFilterCount, advancedFilterLabel, albumSourceCount, allSources, allVisibleSelected, applyDraftFilters, applySourceFilters, batchDeleting,
    batchLoading, batchToggling, buildSourceParams, canBatchSyncSelected, canBatchToggleSelected, canDragReorder, clearHoverHideTimer, clearIgnored,
    clearSelection, clearSourceFilters, confirmBatchDelete, confirmDelete, confirmRebuild, desktopActionDensity, draftEnabledFilter, draftIssueFilter,
    draftStatusFilter, draftSubscribedFilter, dragIdx, dragOverIdx, editTarget, enabledCount, enabledFilter, expandedId,
    expandedLoading, expandedSongs, fetchSources, fetchSummarySources, filteredSources, filterType, forceFullId, formatRelative,
    globalSyncState, handleBatchDelete, handleDelete, handleRebuildSync, hoverCard, hoverHideTimer, isAnySyncing, issueFilter,
    lastSyncTime, loading, moreMenuId, onAlbumCreated, onDragEnd, onDragLeave, onDragOver, onDragStart,
    onDrop, onFilteredDragOver, onFilteredDragStart, onFilteredDrop, onPlaylistCreated, onSourceSaved, onSourceSearchInput, onSourceTabChange,
    openAddPlaylist, openBatchDeleteConfirm, openEdit, openRebuildConfirm, playlistSourceCount, plexTargetHint, plexTargetName, prepareDraftFilters,
    pruneSelectionToVisible, queryString, rebuildActionLabel, rebuildSyncId, refreshSources, removeSourceFilter, repairingSourceId, repairProgress,
    repairSource, resetDraftFilters, restoreSourceFiltersFromRoute, runSelectedBatch, scheduleHideSourceHover, selectedCount, selectedHasAlbum, selectedHasDisabledPlaylist,
    selectedSourceIds, selectedSources, setSourceType, showAdd, showInlineEditAction, showInlineFullSyncAction, showInlineRepairAction, showSourceHover,
    someVisibleSelected, songStatusDot, sourceActiveCount, sourceCanClear, sourceCopyrightCount, sourceCoverSrc, sourceDisplayName, sourceFilterChips,
    sourceFilters, sourceHoverOrigin, sourceIgnoredCount, sourceIssueCount, sourceIssueSummary, sourceMetaLabel, sourceOriginName, sourcePageTabs,
    sources, sourceSearch, sourceSearchDebounce, sourceStateClass, sourceStateLabel, sourceSyncTriggerTitle, statusFilter, statusFilterOptions, subscribedFilter,
    syncingSourceId, syncResultDotClass, syncResultLabel, syncResultTextClass, syncSource, syncSourceFilterQuery, tableShellRef, tableShellResizeObserver,
    tableShellWidth, toggleEnabled, toggleExpand, toggleMoreMenu, toggleSelectAllVisible, toggleSourceSelection, togglingId, totalCopyright,
    totalIgnored, totalSourceCount, triggerSourceSync, updateTableShellWidth,
  }
}
