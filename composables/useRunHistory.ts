import type { JobStatus, TaskRunSummary, TaskRunType } from '~~/server/lib/job/types'
import type { TaskSourceOption } from '~~/server/lib/task-filter-options'
import { countActiveFilters, formatDateFilterLabel, parseAllowedQueryValue, parseDateQueryValue } from '~~/composables/useFilterQuery'
import { useRuns } from '~~/composables/useRuns'
import { useDebounceFn } from '~~/composables/useTiming'
import { sseSubscribe } from './sse'

export function useRunHistory() {
  const route = useRoute()
  const router = useRouter()
  const api = useApi()
  const runs = useRuns()
  const sourceOptions = ref<TaskSourceOption[]>([])

  const typeFilters: Array<{ label: string; value: TaskRunType | '' }> = [
    { label: '全部类型', value: '' },
    { label: '首次媒体接管', value: 'source_initialization' },
    { label: '同步', value: 'sync' },
    { label: '补全', value: 'repair' },
    { label: '手动下载', value: 'manual_download' },
  ]
  const statusFilters: Array<{ label: string; value: JobStatus | '' }> = [
    { label: '全部状态', value: '' },
    { label: '运行中', value: 'running' },
    { label: '等待确认', value: 'awaiting_action' },
    { label: '成功', value: 'success' },
    { label: '部分成功', value: 'partial' },
    { label: '失败', value: 'failed' },
    { label: '已取消', value: 'cancelled' },
  ]

  type FilterChipKey = 'search' | 'type' | 'status' | 'source' | 'date'
  const draftType = ref<TaskRunType | ''>('')
  const draftStatus = ref<JobStatus | ''>('')
  const draftSource = ref('')
  const draftFrom = ref<string | null>(null)
  const draftTo = ref<string | null>(null)
  const draftDateFilter = computed(() => ({ from: draftFrom.value, to: draftTo.value }))
  const advancedFilterCount = computed(() => countActiveFilters({
    type: runs.filter.value.type,
    status: runs.filter.value.status,
    sourceId: runs.filter.value.sourceId,
  }) + (runs.filter.value.from || runs.filter.value.to ? 1 : 0))
  const canClear = computed(() => countActiveFilters({
    search: runs.filter.value.search,
    type: runs.filter.value.type,
    status: runs.filter.value.status,
    sourceId: runs.filter.value.sourceId,
    from: runs.filter.value.from,
    to: runs.filter.value.to,
  }) > 0)
  const advancedFilterLabel = computed(() => '筛选')

  function sourceOptionLabel(source: TaskSourceOption) {
    if (!source.deleted) return source.name
    const fallback = source.name === source.id ? source.id.slice(0, 8) : source.name
    return `${fallback}（已删除）`
  }
  function sourceLabel(sourceId: string) {
    const source = sourceOptions.value.find(item => item.id === sourceId)
    return source ? sourceOptionLabel(source) : sourceId
  }

  const filterChips = computed<Array<{ key: FilterChipKey; label: string }>>(() => {
    const chips: Array<{ key: FilterChipKey; label: string }> = []
    if (runs.filter.value.search) chips.push({ key: 'search', label: `搜索：${runs.filter.value.search}` })
    if (runs.filter.value.type) chips.push({ key: 'type', label: `类型：${typeFilters.find(item => item.value === runs.filter.value.type)?.label || runs.filter.value.type}` })
    if (runs.filter.value.status) chips.push({ key: 'status', label: `状态：${statusFilters.find(item => item.value === runs.filter.value.status)?.label || runs.filter.value.status}` })
    if (runs.filter.value.sourceId) chips.push({ key: 'source', label: `来源：${sourceLabel(runs.filter.value.sourceId)}` })
    if (runs.filter.value.from || runs.filter.value.to) chips.push({ key: 'date', label: formatDateFilterLabel(runs.filter.value.from, runs.filter.value.to) })
    return chips
  })

  function localDateKey(date: Date) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
  }
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
      const label = key === todayKey ? '今天' : key === yesterdayKey ? '昨天' : date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })
      const group = groups.get(key) || { key, label, items: [] }
      group.items.push(run)
      groups.set(key, group)
    }
    return [...groups.values()]
  })

  function syncQuery() {
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
  function applyFilters() { searchDebounce.cancel(); syncQuery(); void runs.fetch() }
  const searchDebounce = useDebounceFn(applyFilters, 350)
  function onSearch(value: string) { runs.filter.value.search = value || undefined; searchDebounce.run() }
  function prepareDraftFilters() {
    draftType.value = runs.filter.value.type || ''
    draftStatus.value = runs.filter.value.status || ''
    draftSource.value = runs.filter.value.sourceId || ''
    draftFrom.value = runs.filter.value.from || null
    draftTo.value = runs.filter.value.to || null
  }
  function resetDraftFilters() {
    draftType.value = ''
    draftStatus.value = ''
    draftSource.value = ''
    draftFrom.value = null
    draftTo.value = null
  }
  function setDraftDate(value: { from: string | null; to: string | null }) {
    draftFrom.value = value.from
    draftTo.value = value.to
  }
  function applyDraftFilters(close?: () => void) {
    runs.filter.value.type = draftType.value || undefined
    runs.filter.value.status = draftStatus.value || undefined
    runs.filter.value.sourceId = draftSource.value || undefined
    runs.filter.value.from = draftFrom.value || undefined
    runs.filter.value.to = draftTo.value || undefined
    close?.()
    applyFilters()
  }
  function clearFilters() { runs.filter.value = {}; resetDraftFilters(); applyFilters() }
  function removeFilter(key: FilterChipKey) {
    if (key === 'search') runs.filter.value.search = undefined
    if (key === 'type') runs.filter.value.type = undefined
    if (key === 'status') runs.filter.value.status = undefined
    if (key === 'source') runs.filter.value.sourceId = undefined
    if (key === 'date') { runs.filter.value.from = undefined; runs.filter.value.to = undefined }
    applyFilters()
  }

  let resumeUnsubscribe: (() => void) | null = null
  onUnmounted(() => resumeUnsubscribe?.())
  onMounted(async () => {
    resumeUnsubscribe = sseSubscribe('resync', () => { void runs.fetch().catch(() => {}) })
    const types = typeFilters.map(item => item.value).filter((value): value is TaskRunType => value !== '')
    const statuses = statusFilters.map(item => item.value).filter((value): value is JobStatus => value !== '')
    runs.filter.value = {
      search: typeof route.query.runSearch === 'string' ? route.query.runSearch : undefined,
      type: parseAllowedQueryValue(route.query.runType, types),
      status: parseAllowedQueryValue(route.query.runStatus, statuses),
      sourceId: typeof route.query.runSource === 'string' ? route.query.runSource : undefined,
      from: parseDateQueryValue(route.query.runFrom),
      to: parseDateQueryValue(route.query.runTo),
    }
    try {
      sourceOptions.value = (await api.get<{ sources: TaskSourceOption[] }>('/task-center/filter-options')).sources
    } catch {
      sourceOptions.value = []
    }
    await runs.fetch()
  })

  return {
    advancedFilterCount, advancedFilterLabel, applyDraftFilters, canClear, clearFilters,
    draftDateFilter, draftSource, draftStatus, draftType, filterChips, groupedRuns, onSearch,
    prepareDraftFilters, removeFilter, resetDraftFilters, runs, setDraftDate, sourceOptionLabel,
    sourceOptions, statusFilters, typeFilters,
  }
}
