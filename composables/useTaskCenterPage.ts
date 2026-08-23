import type { TaskSourceOption } from '~~/server/lib/task-filter-options'
import type { FailureRecord, FailureRecordStatus } from '~~/server/lib/tasks/failure-records'
import type { TaskRunSummary, TaskRunType } from '~~/server/lib/job/types'
import {
  countActiveFilters,
  formatDateFilterLabel,
  parseAllowedQueryValue,
  parseDateQueryValue,
} from '~~/composables/useFilterQuery'
import { useFeedback } from '~~/composables/useFeedback'
import { useDebounceFn } from '~~/composables/useTiming'
import { formatRunDuration, runTypeLabel } from '~~/lib/run-presentation'
import { semanticToneClass, type TaskSemanticTone } from '~~/lib/task-status'

export function useTaskCenterPage() {
  type TaskCenterTab = 'overview' | 'failures'
  const route = useRoute()
  const router = useRouter()
  const api = useApi()
  const feedback = useFeedback()
  const tabs: Array<{ key: TaskCenterTab; label: string }> = [
    { key: 'overview', label: '进行中' },
    { key: 'failures', label: '异常处理' },
  ]
  const legacyTabs: Record<string, TaskCenterTab> = {
    downloads: 'overview',
    failures: 'failures',
  }
  const requestedTab = String(route.query.tab || 'overview')
  const activeTab = ref<TaskCenterTab>(legacyTabs[requestedTab] || (['overview', 'failures'].includes(requestedTab) ? requestedTab as TaskCenterTab : 'overview'))

  const { state: syncState, cancelSync } = useSync()
  const failures = useFailures()
  const sourceOptions = ref<TaskSourceOption[]>([])
  const activeRunItems = ref<TaskRunSummary[]>([])
  const primaryActiveRun = computed(() => activeRunItems.value.find(run => run.type === 'sync' || run.type === 'repair') || activeRunItems.value[0] || null)
  const primaryActiveRunId = computed(() => primaryActiveRun.value?.id || null)
  const downloadQueue = useDownloadQueue({ liveRunId: primaryActiveRunId, liveLimit: 12 })
  const secondaryActiveRuns = computed(() => activeRunItems.value.filter(run => run.id !== primaryActiveRun.value?.id))
  const openFailureTotal = ref(0)
  const taskCenterTabs = computed(() => tabs.map(tab => ({
    ...tab,
    count: tab.key === 'failures' && openFailureTotal.value > 0 ? openFailureTotal.value : undefined,
    badgeTone: tab.key === 'failures' ? 'danger' as const : 'neutral' as const,
  })))
  const selectedFailures = ref(new Set<string>())

  const stageLabels: Record<string, string> = {
    fetching_playlist: '获取歌单',
    comparing: '分析差异',
    downloading: '下载歌曲',
    processing_tags: '写入元数据',
    refreshing_plex: '刷新 Plex',
    updating_plex_playlist: '更新歌单',
    reorder: '校准顺序',
    repair: '补全资源',
  }
  const stageDescriptions: Record<string, string> = {
    fetching_playlist: '正在读取本轮同步范围和最新曲目。',
    comparing: '正在判断新增、移除和顺序变化。',
    downloading: '正在下载缺失歌曲并准备写入文件。',
    processing_tags: '正在写入歌词、封面和音频标签。',
    refreshing_plex: '正在等待 Plex 识别新文件。',
    updating_plex_playlist: '正在更新 Plex 歌单成员。',
    reorder: '正在将 Plex 顺序校准为目标顺序。',
    repair: '正在补齐缺失的歌词、封面或元数据。',
  }
  const stageWeights: Record<string, number> = {
    fetching_playlist: 8, comparing: 22, downloading: 56, processing_tags: 68,
    refreshing_plex: 82, updating_plex_playlist: 92, reorder: 98, repair: 50,
  }
  const stageRanges: Record<string, readonly [number, number]> = {
    fetching_playlist: [4, 8],
    comparing: [8, 22],
    downloading: [22, 56],
    processing_tags: [56, 68],
    refreshing_plex: [68, 82],
    updating_plex_playlist: [82, 92],
    reorder: [92, 99],
    repair: [4, 99],
  }
  const syncStageSequence = [
    { key: 'fetching_playlist', label: '读取歌单' },
    { key: 'comparing', label: '分析差异' },
    { key: 'downloading', label: '下载歌曲' },
    { key: 'processing_tags', label: '写入标签' },
    { key: 'refreshing_plex', label: '刷新 Plex' },
    { key: 'updating_plex_playlist', label: '更新歌单' },
    { key: 'reorder', label: '校准顺序' },
  ] as const
  const stageLabel = computed(() => stageLabels[syncState.value?.currentStage || ''] || '准备运行')
  const liveDescription = computed(() => stageDescriptions[syncState.value?.currentStage || ''] || '任务正在推进。')
  const liveTitle = computed(() => syncState.value?.currentSourceName ? `${stageLabel.value} · ${syncState.value.currentSourceName}` : stageLabel.value)
  const livePercent = computed(() => {
    const progress = syncState.value?.progress
    const currentStage = syncState.value?.currentStage || ''
    const range = stageRanges[currentStage]
    if (progress?.total && range) {
      const ratio = Math.max(0, Math.min(1, progress.current / progress.total))
      return Math.min(99, Math.round(range[0] + (range[1] - range[0]) * ratio))
    }
    return stageWeights[currentStage] || 4
  })
  const overviewStageItems = computed(() => {
    const currentStage = syncState.value?.currentStage || ''
    if (currentStage === 'repair') {
      return [{ key: 'repair', label: stageLabels.repair, state: 'current' as const }]
    }
    const currentIndex = syncStageSequence.findIndex(stage => stage.key === currentStage)
    return syncStageSequence.map((stage, index) => ({
      ...stage,
      state: currentIndex < 0
        ? 'upcoming' as const
        : index < currentIndex
          ? 'complete' as const
          : index === currentIndex
            ? 'current' as const
            : 'upcoming' as const,
    }))
  })
  const elapsedLabel = computed(() => formatElapsed(syncState.value?.startedAt || ''))

  const failureTypeFilters: Array<{ label: string; value: TaskRunType | '' }> = [
    { label: '全部类型', value: '' },
    { label: '同步', value: 'sync' },
    { label: '补全', value: 'repair' },
    { label: '手动下载', value: 'manual_download' },
  ]
  const failureStatusTabs: Array<{ label: string; value: FailureRecordStatus }> = [
    { label: '待处理', value: 'open' },
    { label: '已忽略', value: 'ignored' },
    { label: '已解决', value: 'resolved' },
  ]
  const failureKindFilters = [
    { label: '全部阶段', value: '' },
    { label: '下载失败', value: 'failed_download' },
    { label: '元数据失败', value: 'failed_tags' },
    { label: 'Plex 匹配失败', value: 'failed_plex_match' },
    { label: 'Plex 更新失败', value: 'failed_plex_insert' },
    { label: '版权受限', value: 'copyright_restricted' },
    { label: '连续失败', value: 'ignored_failure' },
  ]
  type FailureFilterChipKey = 'search' | 'type' | 'kind' | 'source' | 'date'
  const draftFailureType = ref<TaskRunType | ''>('')
  const draftFailureKind = ref('')
  const draftFailureSource = ref('')
  const draftFailureFrom = ref<string | null>(null)
  const draftFailureTo = ref<string | null>(null)
  const draftFailureDateFilter = computed(() => ({ from: draftFailureFrom.value, to: draftFailureTo.value }))
  const failureAdvancedFilterCount = computed(() => countActiveFilters({
    type: failures.filter.value.type,
    failureKind: failures.filter.value.failureKind,
    sourceId: failures.filter.value.sourceId,
  }) + (failures.filter.value.from || failures.filter.value.to ? 1 : 0))
  const failureActiveFilterCount = computed(() => countActiveFilters({
    search: failures.filter.value.search,
    type: failures.filter.value.type,
    failureKind: failures.filter.value.failureKind,
    sourceId: failures.filter.value.sourceId,
    from: failures.filter.value.from,
    to: failures.filter.value.to,
  }))
  const failureCanClear = computed(() => failureActiveFilterCount.value > 0)
  const failureAdvancedFilterLabel = computed(() => failureAdvancedFilterCount.value > 0 ? '筛选' : '高级筛选')
  const failureFilterChips = computed<Array<{ key: FailureFilterChipKey; label: string }>>(() => {
    const chips: Array<{ key: FailureFilterChipKey; label: string }> = []
    if (failures.filter.value.search) chips.push({ key: 'search', label: `搜索：${failures.filter.value.search}` })
    if (failures.filter.value.type) chips.push({ key: 'type', label: `类型：${failureTypeFilters.find(item => item.value === failures.filter.value.type)?.label || failures.filter.value.type}` })
    if (failures.filter.value.failureKind) chips.push({ key: 'kind', label: `阶段：${failureKindFilters.find(item => item.value === failures.filter.value.failureKind)?.label || failures.filter.value.failureKind}` })
    if (failures.filter.value.sourceId) chips.push({ key: 'source', label: `来源：${sourceLabel(failures.filter.value.sourceId)}` })
    if (failures.filter.value.from || failures.filter.value.to) chips.push({ key: 'date', label: formatDateFilterLabel(failures.filter.value.from, failures.filter.value.to) })
    return chips
  })
  const failureEmptyTitle = computed(() => failures.filter.value.status === 'resolved' ? '暂无已解决问题' : failures.filter.value.status === 'ignored' ? '暂无已忽略问题' : '没有待处理问题')
  const failureEmptyDescription = computed(() => failures.filter.value.status === 'open' ? '失败项重试成功后会自动从这里消失。' : '当前状态下没有匹配记录。')

  function switchTab(tab: TaskCenterTab) {
    activeTab.value = tab
    void router.replace({ query: { ...route.query, tab: tab === 'overview' ? undefined : tab, id: undefined } })
  }
  function onTaskCenterTabChange(tab: string) {
    if (tab === 'overview' || tab === 'failures') switchTab(tab)
  }

  function syncFailureQuery() {
    void router.replace({ query: {
      ...route.query,
      tab: 'failures',
      failureStatus: failures.filter.value.status === 'open' ? undefined : failures.filter.value.status,
      failureSearch: failures.filter.value.search || undefined,
      failureType: failures.filter.value.type || undefined,
      failureKind: failures.filter.value.failureKind || undefined,
      failureSource: failures.filter.value.sourceId || undefined,
      failureFrom: failures.filter.value.from || undefined,
      failureTo: failures.filter.value.to || undefined,
    } })
  }
  function applyFailureFilters() { failureSearchDebounce.cancel(); selectedFailures.value = new Set(); syncFailureQuery(); void failures.fetch() }
  const failureSearchDebounce = useDebounceFn(applyFailureFilters, 350)
  function onFailureSearch(value: string) { failures.filter.value.search = value || undefined; failureSearchDebounce.run() }
  function setFailureStatus(value: FailureRecordStatus) { failures.filter.value.status = value; applyFailureFilters() }
  function prepareFailureDraftFilters() {
    draftFailureType.value = failures.filter.value.type || ''
    draftFailureKind.value = failures.filter.value.failureKind || ''
    draftFailureSource.value = failures.filter.value.sourceId || ''
    draftFailureFrom.value = failures.filter.value.from || null
    draftFailureTo.value = failures.filter.value.to || null
  }
  function resetFailureDraftFilters() {
    draftFailureType.value = ''
    draftFailureKind.value = ''
    draftFailureSource.value = ''
    draftFailureFrom.value = null
    draftFailureTo.value = null
  }
  function setDraftFailureDate(value: { from: string | null; to: string | null }) {
    draftFailureFrom.value = value.from
    draftFailureTo.value = value.to
  }
  function applyFailureDraftFilters(close?: () => void) {
    failures.filter.value.type = draftFailureType.value || undefined
    failures.filter.value.failureKind = draftFailureKind.value || undefined
    failures.filter.value.sourceId = draftFailureSource.value || undefined
    failures.filter.value.from = draftFailureFrom.value || undefined
    failures.filter.value.to = draftFailureTo.value || undefined
    close?.()
    applyFailureFilters()
  }
  function clearFailureFilters() {
    failures.filter.value = { status: failures.filter.value.status || 'open' }
    resetFailureDraftFilters()
    applyFailureFilters()
  }
  function removeFailureFilter(key: FailureFilterChipKey) {
    if (key === 'search') failures.filter.value.search = undefined
    if (key === 'type') failures.filter.value.type = undefined
    if (key === 'kind') failures.filter.value.failureKind = undefined
    if (key === 'source') failures.filter.value.sourceId = undefined
    if (key === 'date') {
      failures.filter.value.from = undefined
      failures.filter.value.to = undefined
    }
    applyFailureFilters()
  }
  function toggleFailure(id: string) {
    const next = new Set(selectedFailures.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selectedFailures.value = next
  }
  function isRetryable(record: FailureRecord) { return record.downloadTaskIds.length > 0 && record.failureKind !== 'copyright_restricted' }
  function failureRetryUnavailableReason(record: FailureRecord): string {
    if (record.failureKind === 'copyright_restricted') return '版权受限无法在异常列表直接重试，请从运行或同步源重新执行。'
    if (record.downloadTaskIds.length === 0) return '这条异常没有可直接重试的下载任务，请从运行或同步源重新执行。'
    return '请从运行或同步源重新执行。'
  }
  async function retryFailure(id: string) { showMutationResult(await failures.batchRetry([id])) }
  async function ignoreFailure(id: string) { showMutationResult(await failures.batchIgnore([id])) }
  async function reopenFailure(id: string) { showMutationResult(await failures.batchReopen([id])) }
  async function batchRetry() { showMutationResult(await failures.batchRetry([...selectedFailures.value])); selectedFailures.value = new Set() }
  async function batchIgnore() { showMutationResult(await failures.batchIgnore([...selectedFailures.value])); selectedFailures.value = new Set() }
  async function batchReopen() { showMutationResult(await failures.batchReopen([...selectedFailures.value])); selectedFailures.value = new Set() }
  function showMutationResult(result: { count: number; msg: string }) {
    if (result.count > 0) feedback.success(result.msg || '操作已完成')
    else feedback.warning(result.msg || '没有可处理项目')
  }

  async function handleCancelSync() {
    try {
      await cancelSync()
      feedback.success('已发送取消请求')
    } catch (err) {
      feedback.error('取消同步失败', err instanceof Error ? err.message : '请稍后重试')
    }
  }
  function failureKindLabel(kind: string) {
    return failureKindFilters.find(item => item.value === kind)?.label || kind
  }
  function failureKindTone(kind: string): TaskSemanticTone {
    if (kind === 'copyright_restricted' || kind === 'ignored_failure') return 'ignored'
    if (kind === 'failed_plex_match' || kind === 'failed_plex_insert') return 'warning'
    return 'failure'
  }
  function failureKindIcon(kind: string): string {
    const tone = failureKindTone(kind)
    if (tone === 'ignored') return 'ignored'
    if (tone === 'warning') return 'warn'
    return 'failure'
  }
  function failureReasonLabel(record: FailureRecord): string {
    const rawReason = record.failureReason?.trim()
    if (rawReason && rawReason !== record.failureKind) return rawReason
    const fallbacks: Record<string, string> = {
      failed_download: '歌曲在下载阶段失败，可重试或查看关联运行获取更多上下文。',
      failed_tags: '音频已下载，但元数据或标签写入未完成。',
      failed_plex_match: 'Plex 未在重试窗口内识别到已下载文件。',
      failed_plex_insert: 'Plex 已识别歌曲，但未能完成歌单更新。',
      copyright_restricted: '网易云未提供可下载音源，本次已按版权限制跳过。',
      ignored_failure: '连续失败达到缓存阈值，系统已暂停自动重试。清除对应歌曲的失败缓存后可再次尝试。',
    }
    return fallbacks[record.failureKind] || '未提供具体失败原因'
  }
  function sourceLabel(sourceId: string) {
    const source = sourceOptions.value.find(item => item.id === sourceId)
    return source ? sourceOptionLabel(source) : sourceId
  }
  function sourceOptionLabel(source: TaskSourceOption) {
    if (!source.deleted) return source.name
    const fallback = source.name === source.id ? source.id.slice(0, 8) : source.name
    return `${fallback}（已删除）`
  }
  function formatTime(value: string) { return new Date(value).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  function formatElapsed(value: string) {
    if (!value) return '刚开始'
    return formatRunDuration(Math.max(0, Date.now() - new Date(value).getTime()))
  }
  async function refreshOverview() {
    const [activeResponse, failureResponse] = await Promise.all([
      api.get<{ items: TaskRunSummary[]; total: number }>('/runs', { limit: '20', status: 'running' }),
      api.get<{ items: FailureRecord[]; total: number }>('/tasks/failures', { limit: '1', status: 'open' }),
    ])
    activeRunItems.value = activeResponse.items
    openFailureTotal.value = failureResponse.total
  }

  onMounted(async () => {
    const runTypes = failureTypeFilters.map(item => item.value).filter((value): value is TaskRunType => value !== '')
    const failureKinds = failureKindFilters.map(item => item.value).filter((value): value is string => value !== '')
    const failureStatuses = failureStatusTabs.map(item => item.value)
    failures.filter.value = {
      status: parseAllowedQueryValue(route.query.failureStatus, failureStatuses) || 'open',
      search: typeof route.query.failureSearch === 'string' ? route.query.failureSearch : undefined,
      type: parseAllowedQueryValue(route.query.failureType, runTypes),
      failureKind: parseAllowedQueryValue(route.query.failureKind, failureKinds),
      sourceId: typeof route.query.failureSource === 'string' ? route.query.failureSource : undefined,
      from: parseDateQueryValue(route.query.failureFrom),
      to: parseDateQueryValue(route.query.failureTo),
    }
    void router.replace({ query: {
      ...route.query,
      tab: activeTab.value === 'overview' ? undefined : activeTab.value,
      failureStatus: failures.filter.value.status === 'open' ? undefined : failures.filter.value.status,
      failureType: failures.filter.value.type || undefined,
      failureKind: failures.filter.value.failureKind || undefined,
      failureFrom: failures.filter.value.from || undefined,
      failureTo: failures.filter.value.to || undefined,
    } })
    try {
      const options = await api.get<{ sources: TaskSourceOption[] }>('/task-center/filter-options')
      sourceOptions.value = options.sources
    } catch {
      sourceOptions.value = []
    }
    await Promise.all([failures.fetch(), refreshOverview()])
  })

  watch(() => syncState.value?.isRunning, (running, previous) => {
    if (running !== previous) void refreshOverview()
  })

  return {
    activeRunItems, activeTab, applyFailureDraftFilters, applyFailureFilters, batchIgnore, batchReopen,
    batchRetry, clearFailureFilters, draftFailureDateFilter, draftFailureFrom, draftFailureKind, draftFailureSource,
    draftFailureTo, draftFailureType,
    downloadQueue, elapsedLabel, failureActiveFilterCount, failureAdvancedFilterCount, failureAdvancedFilterLabel, failureCanClear, failureEmptyDescription, failureEmptyTitle, failureFilterChips,
    failureKindFilters, failureKindIcon, failureKindLabel, failureKindTone, failureReasonLabel, failureRetryUnavailableReason, failures, failureSearchDebounce,
    failureStatusTabs, failureTypeFilters,
    formatElapsed, formatRunDuration, formatTime, handleCancelSync, ignoreFailure,
    isRetryable, liveDescription, livePercent, liveTitle, onFailureSearch,
    onTaskCenterTabChange, openFailureTotal, overviewStageItems, prepareFailureDraftFilters, primaryActiveRun, refreshOverview, removeFailureFilter,
    reopenFailure, resetFailureDraftFilters, retryFailure, runTypeLabel, secondaryActiveRuns, selectedFailures,
    semanticToneClass, setDraftFailureDate, setFailureStatus, showMutationResult, sourceOptionLabel, sourceOptions,
    stageLabel, switchTab, syncState, taskCenterTabs, toggleFailure,
  }
}
