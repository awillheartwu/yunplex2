import type { TaskSourceOption } from '~~/server/lib/task-filter-options'
import type { FailureRecord, FailureRecordStatus } from '~~/server/lib/tasks/failure-records'
import type { JobStatus, TaskRunSummary, TaskRunType } from '~~/server/lib/job/types'
import {
  countActiveFilters,
  parseAllowedQueryValue,
  parseDateQueryValue,
} from '~~/composables/useFilterQuery'
import { useFeedback } from '~~/composables/useFeedback'
import { useRuns } from '~~/composables/useRuns'
import { useDebounceFn } from '~~/composables/useTiming'
import { formatRunDuration, runTypeLabel } from '~~/lib/run-presentation'
import { semanticToneClass, type TaskSemanticTone } from '~~/lib/task-status'

export function useTaskCenterPage() {
  type TaskCenterTab = 'overview' | 'runs' | 'failures'
  const route = useRoute()
  const router = useRouter()
  const api = useApi()
  const feedback = useFeedback()
  const tabs: Array<{ key: TaskCenterTab; label: string }> = [
    { key: 'overview', label: '概览' },
    { key: 'runs', label: '运行记录' },
    { key: 'failures', label: '异常处理' },
  ]
  const legacyTabs: Record<string, TaskCenterTab> = {
    activities: 'runs',
    'sync-history': 'runs',
    'download-history': 'runs',
    failures: 'failures',
  }
  const requestedTab = String(route.query.tab || 'overview')
  const activeTab = ref<TaskCenterTab>(legacyTabs[requestedTab] || (['overview', 'runs', 'failures'].includes(requestedTab) ? requestedTab as TaskCenterTab : 'overview'))

  const { state: syncState, loading: syncLoading, error: syncError, triggerSync, cancelSync } = useSync()
  const runs = useRuns()
  const failures = useFailures()
  const sourceOptions = ref<TaskSourceOption[]>([])
  const latestRun = ref<TaskRunSummary | null>(null)
  const activeRunItems = ref<TaskRunSummary[]>([])
  const primaryActiveRun = computed(() => activeRunItems.value.find(run => run.type === 'sync' || run.type === 'repair') || activeRunItems.value[0] || null)
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
  const stageLabel = computed(() => stageLabels[syncState.value?.currentStage || ''] || '准备运行')
  const liveDescription = computed(() => stageDescriptions[syncState.value?.currentStage || ''] || '任务正在推进。')
  const liveTitle = computed(() => syncState.value?.currentSourceName ? `${stageLabel.value} · ${syncState.value.currentSourceName}` : stageLabel.value)
  const livePercent = computed(() => {
    const progress = syncState.value?.progress
    if (progress?.total) return Math.min(99, Math.round((progress.current / progress.total) * 100))
    return stageWeights[syncState.value?.currentStage || ''] || 4
  })
  const elapsedLabel = computed(() => formatElapsed(syncState.value?.startedAt || ''))

  const runTypeFilters: Array<{ label: string; value: TaskRunType | '' }> = [
    { label: '全部类型', value: '' },
    { label: '同步', value: 'sync' },
    { label: '补全', value: 'repair' },
    { label: '手动下载', value: 'manual_download' },
  ]
  const runStatusFilters: Array<{ label: string; value: JobStatus | '' }> = [
    { label: '全部状态', value: '' },
    { label: '运行中', value: 'running' },
    { label: '成功', value: 'success' },
    { label: '部分成功', value: 'partial' },
    { label: '失败', value: 'failed' },
    { label: '已取消', value: 'cancelled' },
  ]
  type RunFilterChipKey = 'search' | 'type' | 'status' | 'source' | 'date'
  const draftRunType = ref<TaskRunType | ''>('')
  const draftRunStatus = ref<JobStatus | ''>('')
  const draftRunSource = ref('')
  const draftRunFrom = ref<string | null>(null)
  const draftRunTo = ref<string | null>(null)
  const draftRunDateFilter = computed(() => ({ from: draftRunFrom.value, to: draftRunTo.value }))
  const runAdvancedFilterCount = computed(() => countActiveFilters({
    type: runs.filter.value.type,
    status: runs.filter.value.status,
    sourceId: runs.filter.value.sourceId,
  }) + (runs.filter.value.from || runs.filter.value.to ? 1 : 0))
  const runActiveFilterCount = computed(() => countActiveFilters({
    search: runs.filter.value.search,
    type: runs.filter.value.type,
    status: runs.filter.value.status,
    sourceId: runs.filter.value.sourceId,
    from: runs.filter.value.from,
    to: runs.filter.value.to,
  }))
  const runCanClear = computed(() => runActiveFilterCount.value > 0)
  const runAdvancedFilterLabel = computed(() => runAdvancedFilterCount.value > 0 ? '筛选' : '高级筛选')
  const runFilterChips = computed<Array<{ key: RunFilterChipKey; label: string }>>(() => {
    const chips: Array<{ key: RunFilterChipKey; label: string }> = []
    if (runs.filter.value.search) chips.push({ key: 'search', label: `搜索：${runs.filter.value.search}` })
    if (runs.filter.value.type) chips.push({ key: 'type', label: `类型：${runTypeFilters.find(item => item.value === runs.filter.value.type)?.label || runs.filter.value.type}` })
    if (runs.filter.value.status) chips.push({ key: 'status', label: `状态：${runStatusFilters.find(item => item.value === runs.filter.value.status)?.label || runs.filter.value.status}` })
    if (runs.filter.value.sourceId) chips.push({ key: 'source', label: `来源：${sourceLabel(runs.filter.value.sourceId)}` })
    if (runs.filter.value.from || runs.filter.value.to) chips.push({ key: 'date', label: formatDateFilter(runs.filter.value.from, runs.filter.value.to) })
    return chips
  })
  const groupedRuns = computed(() => {
    const groups = new Map<string, { key: string; label: string; items: TaskRunSummary[] }>()
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)
    const todayKey = localDateKey(today)
    const yesterdayKey = localDateKey(yesterday)

    for (const run of runs.items.value) {
      const date = new Date(run.startedAt)
      const key = localDateKey(date)
      const label = key === todayKey
        ? '今天'
        : key === yesterdayKey
          ? '昨天'
          : date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })
      const group = groups.get(key) || { key, label, items: [] }
      group.items.push(run)
      groups.set(key, group)
    }
    return [...groups.values()]
  })

  function localDateKey(date: Date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-')
  }

  const failureStatusTabs: Array<{ label: string; value: FailureRecordStatus }> = [
    { label: '待处理', value: 'open' },
    { label: '已忽略', value: 'ignored' },
    { label: '已解决', value: 'resolved' },
  ]
  const failureTypeFilters: Array<{ label: string; value: TaskRunType | '' }> = runTypeFilters
  const failureKindFilters = [
    { label: '全部阶段', value: '' },
    { label: '下载失败', value: 'failed_download' },
    { label: '元数据失败', value: 'failed_tags' },
    { label: 'Plex 匹配失败', value: 'failed_plex_match' },
    { label: 'Plex 更新失败', value: 'failed_plex_insert' },
    { label: '版权受限', value: 'copyright_restricted' },
    { label: '重复失败', value: 'ignored_failure' },
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
    if (failures.filter.value.from || failures.filter.value.to) chips.push({ key: 'date', label: formatDateFilter(failures.filter.value.from, failures.filter.value.to) })
    return chips
  })
  const failureEmptyTitle = computed(() => failures.filter.value.status === 'resolved' ? '暂无已解决问题' : failures.filter.value.status === 'ignored' ? '暂无已忽略问题' : '没有待处理问题')
  const failureEmptyDescription = computed(() => failures.filter.value.status === 'open' ? '失败项重试成功后会自动从这里消失。' : '当前状态下没有匹配记录。')

  function switchTab(tab: TaskCenterTab) {
    activeTab.value = tab
    void router.replace({ query: { ...route.query, tab: tab === 'overview' ? undefined : tab, id: undefined } })
  }
  function onTaskCenterTabChange(tab: string) {
    if (tab === 'overview' || tab === 'runs' || tab === 'failures') switchTab(tab)
  }
  function syncRunQuery() {
    void router.replace({ query: {
      ...route.query,
      tab: 'runs',
      runSearch: runs.filter.value.search || undefined,
      runType: runs.filter.value.type || undefined,
      runStatus: runs.filter.value.status || undefined,
      runSource: runs.filter.value.sourceId || undefined,
      runFrom: runs.filter.value.from || undefined,
      runTo: runs.filter.value.to || undefined,
    } })
  }
  function applyRunFilters() { syncRunQuery(); void runs.fetch() }
  const runSearchDebounce = useDebounceFn(applyRunFilters, 350)
  function onRunSearch(value: string) { runs.filter.value.search = value || undefined; syncRunQuery(); runSearchDebounce.run() }
  function prepareRunDraftFilters() {
    draftRunType.value = runs.filter.value.type || ''
    draftRunStatus.value = runs.filter.value.status || ''
    draftRunSource.value = runs.filter.value.sourceId || ''
    draftRunFrom.value = runs.filter.value.from || null
    draftRunTo.value = runs.filter.value.to || null
  }
  function resetRunDraftFilters() {
    draftRunType.value = ''
    draftRunStatus.value = ''
    draftRunSource.value = ''
    draftRunFrom.value = null
    draftRunTo.value = null
  }
  function setDraftRunDate(value: { from: string | null; to: string | null }) {
    draftRunFrom.value = value.from
    draftRunTo.value = value.to
  }
  function applyRunDraftFilters(close?: () => void) {
    runs.filter.value.type = draftRunType.value || undefined
    runs.filter.value.status = draftRunStatus.value || undefined
    runs.filter.value.sourceId = draftRunSource.value || undefined
    runs.filter.value.from = draftRunFrom.value || undefined
    runs.filter.value.to = draftRunTo.value || undefined
    close?.()
    applyRunFilters()
  }
  function clearRunFilters() {
    runs.filter.value = {}
    resetRunDraftFilters()
    applyRunFilters()
  }
  function removeRunFilter(key: RunFilterChipKey) {
    if (key === 'search') runs.filter.value.search = undefined
    if (key === 'type') runs.filter.value.type = undefined
    if (key === 'status') runs.filter.value.status = undefined
    if (key === 'source') runs.filter.value.sourceId = undefined
    if (key === 'date') {
      runs.filter.value.from = undefined
      runs.filter.value.to = undefined
    }
    applyRunFilters()
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
  function applyFailureFilters() { selectedFailures.value = new Set(); syncFailureQuery(); void failures.fetch() }
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

  async function handleTriggerSync() {
    try {
      await triggerSync()
      await refreshOverview()
      feedback.success('同步已触发', '运行记录会在任务中心持续更新。')
    } catch (err) {
      feedback.error('同步触发失败', err instanceof Error ? err.message : '请稍后重试')
    }
  }
  async function handleCancelSync() {
    try {
      await cancelSync()
      feedback.success('已发送取消请求')
    } catch (err) {
      feedback.error('取消同步失败', err instanceof Error ? err.message : '请稍后重试')
    }
  }
  function runBadgeStatus(status: JobStatus): 'ok' | 'error' | 'warning' | 'running' | 'idle' {
    return status === 'success' ? 'ok' : status === 'failed' ? 'error' : status === 'partial' ? 'warning' : status === 'running' ? 'running' : 'idle'
  }
  function failureKindLabel(kind: string) {
    const labels: Record<string, string> = {
      failed_download: '下载失败', failed_tags: '元数据失败',
      failed_plex_match: 'Plex 匹配失败', failed_plex_insert: 'Plex 更新失败',
      copyright_restricted: '版权受限', ignored_failure: '重复失败',
    }
    return labels[kind] || kind
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
      ignored_failure: '连续失败达到忽略阈值，系统已暂停自动重试。',
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
  function formatDateFilter(from?: string, to?: string) {
    if (from && to) return `日期：${from} 至 ${to}`
    if (from) return `日期：${from} 起`
    return `日期：截至 ${to}`
  }
  function formatTime(value: string) { return new Date(value).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  function formatElapsed(value: string) {
    if (!value) return '刚开始'
    return formatRunDuration(Math.max(0, Date.now() - new Date(value).getTime()))
  }
  async function refreshOverview() {
    const [runResponse, activeResponse, failureResponse] = await Promise.all([
      api.get<{ items: TaskRunSummary[]; total: number }>('/runs', { limit: '1' }),
      api.get<{ items: TaskRunSummary[]; total: number }>('/runs', { limit: '20', status: 'running' }),
      api.get<{ items: FailureRecord[]; total: number }>('/tasks/failures', { limit: '1', status: 'open' }),
    ])
    latestRun.value = runResponse.items[0] || null
    activeRunItems.value = activeResponse.items
    openFailureTotal.value = failureResponse.total
  }

  onMounted(async () => {
    const runTypes = runTypeFilters.map(item => item.value).filter((value): value is TaskRunType => value !== '')
    const runStatuses = runStatusFilters.map(item => item.value).filter((value): value is JobStatus => value !== '')
    const failureKinds = failureKindFilters.map(item => item.value).filter((value): value is string => value !== '')
    const failureStatuses = failureStatusTabs.map(item => item.value)
    runs.filter.value = {
      search: typeof route.query.runSearch === 'string' ? route.query.runSearch : undefined,
      type: parseAllowedQueryValue(route.query.runType, runTypes),
      status: parseAllowedQueryValue(route.query.runStatus, runStatuses),
      sourceId: typeof route.query.runSource === 'string' ? route.query.runSource : undefined,
      from: parseDateQueryValue(route.query.runFrom),
      to: parseDateQueryValue(route.query.runTo),
    }
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
      runType: runs.filter.value.type || undefined,
      runStatus: runs.filter.value.status || undefined,
      runFrom: runs.filter.value.from || undefined,
      runTo: runs.filter.value.to || undefined,
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
    await Promise.all([runs.fetch(), failures.fetch(), refreshOverview()])
    const legacyId = typeof route.query.id === 'string' ? route.query.id : ''
    if (legacyId) await navigateTo(`/task-center/runs/${legacyId}`, { replace: true })
  })

  watch(() => syncState.value?.isRunning, (running, previous) => {
    if (running !== previous) void refreshOverview()
  })

  return {
    activeRunItems, activeTab, applyFailureDraftFilters, applyFailureFilters, applyRunDraftFilters, applyRunFilters, batchIgnore, batchReopen,
    batchRetry, cancelSync, clearFailureFilters, clearRunFilters, draftFailureDateFilter, draftFailureFrom, draftFailureKind, draftFailureSource,
    draftFailureTo, draftFailureType, draftRunDateFilter, draftRunFrom, draftRunSource, draftRunStatus, draftRunTo, draftRunType,
    elapsedLabel, failureActiveFilterCount, failureAdvancedFilterCount, failureAdvancedFilterLabel, failureCanClear, failureEmptyDescription, failureEmptyTitle, failureFilterChips,
    failureKindFilters, failureKindIcon, failureKindLabel, failureKindTone, failureReasonLabel, failureRetryUnavailableReason, failures, failureSearchDebounce,
    failureStatusTabs,
    formatDateFilter, formatElapsed, formatRunDuration, formatTime, groupedRuns, handleCancelSync, handleTriggerSync, ignoreFailure,
    isRetryable, latestRun, liveDescription, livePercent, liveTitle, localDateKey, onFailureSearch, onRunSearch,
    onTaskCenterTabChange, openFailureTotal, prepareFailureDraftFilters, prepareRunDraftFilters, primaryActiveRun, refreshOverview, removeFailureFilter, removeRunFilter,
    reopenFailure, requestedTab, resetFailureDraftFilters, resetRunDraftFilters, retryFailure, runActiveFilterCount, runAdvancedFilterCount, runAdvancedFilterLabel,
    runBadgeStatus, runCanClear, runFilterChips, runs, runSearchDebounce, runTypeLabel, secondaryActiveRuns, selectedFailures,
    semanticToneClass, setDraftFailureDate, setDraftRunDate, setFailureStatus, showMutationResult, sourceLabel, sourceOptionLabel, sourceOptions,
    stageLabel, switchTab, syncError, syncFailureQuery, syncLoading, syncRunQuery, syncState, taskCenterTabs,
    toggleFailure, triggerSync,
  }
}
