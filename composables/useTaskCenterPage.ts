import type { TaskSourceOption } from '~~/server/lib/task-filter-options'
import type { FailureRecord, FailureRecordStatus } from '~~/server/lib/tasks/failure-records'
import type { TaskRunType } from '~~/server/lib/job/types'
import {
  countActiveFilters,
  formatDateFilterLabel,
  parseAllowedQueryValue,
  parseDateQueryValue,
} from '~~/composables/useFilterQuery'
import { useFeedback } from '~~/composables/useFeedback'
import { useDebounceFn } from '~~/composables/useTiming'
import { sseSubscribe } from '~~/composables/sse'
import { runTypeLabel } from '~~/lib/run-presentation'
import { semanticToneClass, type TaskSemanticTone } from '~~/lib/task-status'
import { getDomainErrorDefinition, isDomainErrorCode } from '~~/shared/domain-errors'

export function useTaskCenterPage() {
  type TaskCenterTab = 'overview' | 'failures' | 'runs'
  const route = useRoute()
  const router = useRouter()
  const api = useApi()
  const feedback = useFeedback()
  const tabs: Array<{ key: TaskCenterTab; label: string }> = [
    { key: 'overview', label: '进行中' },
    { key: 'runs', label: '运行记录' },
    { key: 'failures', label: '异常处理' },
  ]
  const legacyTabs: Record<string, TaskCenterTab> = {
    downloads: 'overview',
    failures: 'failures',
    activities: 'runs',
    'sync-history': 'runs',
    'download-history': 'runs',
  }
  const requestedTab = String(route.query.tab || 'overview')
  const activeTab = ref<TaskCenterTab>(legacyTabs[requestedTab] || (['overview', 'failures', 'runs'].includes(requestedTab) ? requestedTab as TaskCenterTab : 'overview'))
  watch(() => route.query.tab, value => {
    const tab = String(value || 'overview')
    activeTab.value = legacyTabs[tab] || (['overview', 'failures', 'runs'].includes(tab) ? tab as TaskCenterTab : 'overview')
  })

  const failures = useFailures()
  const sourceOptions = ref<TaskSourceOption[]>([])
  const openFailureTotal = ref(0)
  const taskCenterTabs = computed(() => tabs.map(tab => ({
    ...tab,
    count: tab.key === 'failures' && openFailureTotal.value > 0 ? openFailureTotal.value : undefined,
    badgeTone: tab.key === 'failures' ? 'danger' as const : 'neutral' as const,
  })))
  const selectedFailures = ref(new Set<string>())

  const failureTypeFilters: Array<{ label: string; value: TaskRunType | '' }> = [
    { label: '全部类型', value: '' },
    { label: '首次媒体接管', value: 'source_initialization' },
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
    { label: '认证失效', value: 'authentication_failed' },
    { label: '请求受限', value: 'rate_limited' },
    { label: 'Plex 不可用', value: 'plex_unavailable' },
    { label: '文件写入失败', value: 'filesystem_failed' },
    { label: '媒体身份冲突', value: 'media_identity_conflict' },
    { label: '任务被中断', value: 'scheduler_interrupted' },
    { label: '任务占用中', value: 'concurrent_operation' },
    { label: '未知错误', value: 'unknown_error' },
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
  const failureAdvancedFilterLabel = computed(() => '筛选')
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
    if (tab === 'overview' || tab === 'failures' || tab === 'runs') switchTab(tab)
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
  function isRetryable(record: FailureRecord) { return record.downloadTaskIds.length > 0 && record.retryable }
  function failureRetryUnavailableReason(record: FailureRecord): string {
    if (!record.retryable) return `${record.userMessage} 当前错误策略不允许直接重试。`
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

  function failureKindLabel(kind: string) {
    return isDomainErrorCode(kind) ? getDomainErrorDefinition(kind).label : failureKindFilters.find(item => item.value === kind)?.label || kind
  }
  function failureKindTone(kind: string): TaskSemanticTone {
    const definition = getDomainErrorDefinition(kind)
    if (definition.severity === 'info') return 'ignored'
    if (definition.severity === 'warning') return 'warning'
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
    return record.userMessage || getDomainErrorDefinition(record.errorCode || record.failureKind).userMessage
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
  async function refreshOverview() {
    const response = await api.get<{ total: number }>('/tasks/failures', { limit: '1', status: 'open' })
    openFailureTotal.value = response.total
  }

  onMounted(async () => {
    syncCompletionUnsubscribe = sseSubscribe('stage-change', (data) => {
      if (data.stage === 'idle') void refreshOverview().catch(() => {})
    })
    repairProgressUnsubscribe = sseSubscribe('repair-progress', (data) => {
      if (data.finished === true) void refreshOverview()
    })
    resumeUnsubscribe = sseSubscribe('resync', () => {
      void Promise.all([failures.fetch(), refreshOverview()]).catch(() => {})
    })
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

  let syncCompletionUnsubscribe: (() => void) | null = null
  let repairProgressUnsubscribe: (() => void) | null = null
  let resumeUnsubscribe: (() => void) | null = null
  onUnmounted(() => {
    syncCompletionUnsubscribe?.()
    repairProgressUnsubscribe?.()
    resumeUnsubscribe?.()
    repairProgressUnsubscribe = null
  })


  return {
    activeTab, applyFailureDraftFilters, applyFailureFilters, batchIgnore, batchReopen,
    batchRetry, clearFailureFilters, draftFailureDateFilter, draftFailureFrom, draftFailureKind, draftFailureSource,
    draftFailureTo, draftFailureType,
    failureActiveFilterCount, failureAdvancedFilterCount, failureAdvancedFilterLabel, failureCanClear, failureEmptyDescription, failureEmptyTitle, failureFilterChips,
    failureKindFilters, failureKindIcon, failureKindLabel, failureKindTone, failureReasonLabel, failureRetryUnavailableReason, failures, failureSearchDebounce,
    failureStatusTabs, failureTypeFilters,
    formatTime, ignoreFailure,
    isRetryable, onFailureSearch,
    onTaskCenterTabChange, openFailureTotal, prepareFailureDraftFilters, refreshOverview, removeFailureFilter,
    reopenFailure, resetFailureDraftFilters, retryFailure, runTypeLabel, selectedFailures,
    semanticToneClass, setDraftFailureDate, setFailureStatus, showMutationResult, sourceOptionLabel, sourceOptions,
    switchTab, taskCenterTabs, toggleFailure,
  }
}
