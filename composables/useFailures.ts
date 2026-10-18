import type {
  FailureRecord,
  FailureRecordStatus,
} from '~~/server/lib/tasks/failure-records'
import type { TaskRunType } from '~~/server/lib/job/types'
import type { FailureGroup, FailureMutationSelection } from '~~/server/lib/tasks/failure-groups'
import { computed, ref } from 'vue'
import { createLatestAsyncGuard } from '~~/composables/useTiming'

export interface FailureFilter {
  status?: FailureRecordStatus
  type?: TaskRunType | ''
  failureKind?: string
  sourceId?: string
  runId?: string
  groupId?: string
  groupKey?: string
  search?: string
  from?: string
  to?: string
}

export function useFailures() {
  const api = useApi()
  const items = ref<FailureRecord[]>([])
  const groups = ref<FailureGroup[]>([])
  const view = ref<'groups' | 'songs'>('groups')
  const activeGroup = ref<FailureGroup | null>(null)
  const groupTotal = ref(0)
  const total = ref(0)
  const retryableTotal = ref(0)
  const loading = ref(false)
  const mutating = ref(false)
  const error = ref('')
  const page = ref(1)
  let loadedFilter = ''
  const limit = 50
  const filter = ref<FailureFilter>({ status: 'open' })
  const fetchGuard = createLatestAsyncGuard()
  const selected = ref(new Set<string>())
  const excluded = ref(new Set<string>())
  const allMatchingSelected = ref(false)
  const knownRetryable = reactive(new Map<string, boolean>())
  const selectionBusy = computed(() => loading.value || mutating.value || Boolean(error.value))
  const selectionCount = computed(() => allMatchingSelected.value ? Math.max(0, total.value - excluded.value.size) : selected.value.size)
  const selectionRetryableCount = computed(() => allMatchingSelected.value
    ? Math.max(0, retryableTotal.value - [...excluded.value].filter(id => knownRetryable.get(id)).length)
    : [...selected.value].filter(id => knownRetryable.get(id)).length)
  const allPageSelected = computed(() => items.value.length > 0 && items.value.every(item => isSelected(item.id)))
  const somePageSelected = computed(() => !allPageSelected.value && items.value.some(item => isSelected(item.id)))
  watch(() => JSON.stringify([view.value, filter.value]), () => { clearSelection(); knownRetryable.clear() }, { flush: 'sync' })
  const paginationTotal = computed(() => view.value === 'groups' ? groupTotal.value : total.value)
  const pageCount = computed(() => Math.max(1, Math.ceil(paginationTotal.value / limit)))
  const visibleCount = computed(() => view.value === 'groups' ? groups.value.length : items.value.length)

  function toParams(offset = 0): Record<string, string> {
    const params: Record<string, string> = {
      limit: String(limit),
      offset: String(offset),
      status: filter.value.status || 'open',
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    }
    if (filter.value.type) params.type = filter.value.type
    if (filter.value.failureKind) params.failureKind = filter.value.failureKind
    if (filter.value.sourceId) params.sourceId = filter.value.sourceId
    if (filter.value.runId) params.runId = filter.value.runId
    if (filter.value.groupId) params.groupId = filter.value.groupId
    if (filter.value.groupKey) params.groupKey = filter.value.groupKey
    if (filter.value.search) params.search = filter.value.search
    if (filter.value.from) params.from = filter.value.from
    if (filter.value.to) params.to = filter.value.to
    return params
  }

  async function goToPage(target: number) {
    const token = fetchGuard.next()
    const signature = JSON.stringify([view.value, filter.value])
    const grouped = view.value === 'groups'
    let requested = signature !== loadedFilter ? 1 : Math.min(pageCount.value, Math.max(1, Math.trunc(target)))
    loading.value = true
    error.value = ''
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const params = toParams((requested - 1) * limit)
        const response = grouped
          ? await api.get<{ items: FailureGroup[]; total: number; recordTotal: number }>('/tasks/failure-groups', params)
          : await api.get<{ items: FailureRecord[]; total: number; retryableTotal: number }>('/tasks/failures', params)
        if (!fetchGuard.isLatest(token)) return
        const last = Math.max(1, Math.ceil(response.total / limit))
        if (requested > last) { requested = last; continue }
        if ('recordTotal' in response) {
          groups.value = response.items
          groupTotal.value = response.total
          total.value = response.recordTotal
        } else {
          items.value = response.items
          total.value = response.total
          retryableTotal.value = response.retryableTotal
          for (const item of response.items) knownRetryable.set(item.id, item.retryable)
        }
        page.value = requested
        loadedFilter = signature
        return
      }
      error.value = '数据正在变化，请刷新后重试'
    } catch (err) {
      if (fetchGuard.isLatest(token)) error.value = err instanceof Error ? err.message : '读取问题失败'
    } finally {
      if (fetchGuard.isLatest(token)) loading.value = false
    }
  }
  async function fetch() { await goToPage(page.value) }

  function clearSelection() {
    selected.value = new Set()
    excluded.value = new Set()
    allMatchingSelected.value = false
  }

  function isSelected(id: string) {
    return allMatchingSelected.value ? !excluded.value.has(id) : selected.value.has(id)
  }

  function toggleSelection(id: string) {
    if (selectionBusy.value) return
    const selection = allMatchingSelected.value ? excluded : selected
    const next = new Set(selection.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selection.value = next
  }

  function togglePageSelection() {
    if (selectionBusy.value) return
    const selecting = !allPageSelected.value
    const selection = allMatchingSelected.value ? excluded : selected
    const next = new Set(selection.value)
    for (const item of items.value) {
      if (selecting !== allMatchingSelected.value) next.add(item.id)
      else next.delete(item.id)
    }
    selection.value = next
  }

  function selectAllMatching() {
    if (selectionBusy.value || !total.value) return
    selected.value = new Set()
    excluded.value = new Set()
    allMatchingSelected.value = true
  }

  async function setView(value: 'groups' | 'songs') {
    view.value = value
    filter.value.groupId = undefined
    filter.value.groupKey = undefined
    activeGroup.value = null
    await goToPage(1)
  }

  async function openGroup(group: FailureGroup) {
    activeGroup.value = group
    filter.value.groupId = group.id
    filter.value.groupKey = group.key
    view.value = 'songs'
    await goToPage(1)
  }

  async function mutate(endpoint: string, selection: FailureMutationSelection): Promise<{ count: number; msg: string; failed?: boolean }> {
    if (mutating.value) return { count: 0, msg: '操作正在进行' }
    if (!selection.groupId && !selection.ids?.length && !selection.allMatching) return { count: 0, msg: '没有选择问题' }
    mutating.value = true
    try {
      const response = await api.rawPost<{ count: number }>(endpoint, selection)
      if (response.code !== 0) return { count: 0, msg: response.msg || '操作失败', failed: true }
      await fetch()
      return { count: response.data?.count ?? 0, msg: response.msg || '' }
    } catch (err) {
      return { count: 0, msg: err instanceof Error ? err.message : '操作失败，请稍后重试', failed: true }
    } finally { mutating.value = false }
  }

  return {
    items,
    groups,
    view,
    activeGroup,
    groupTotal,
    paginationTotal,
    visibleCount,
    total,
    loading,
    mutating,
    error,
    page,
    pageSize: limit,
    filter,
    selectionBusy,
    selectionCount,
    selectionRetryableCount,
    allMatchingSelected,
    allPageSelected,
    somePageSelected,
    isSelected,
    toggleSelection,
    togglePageSelection,
    selectAllMatching,
    clearSelection,
    fetch,
    goToPage,
    setView,
    openGroup,
    mutateSelected: (action: 'retry' | 'ignore') => mutate(`/tasks/failures/batch-${action}`, allMatchingSelected.value
      ? { allMatching: true, excludeIds: [...excluded.value], filter: toParams() }
      : { ids: [...selected.value] }),
    mutateGroup: (group: FailureGroup, action: 'retry' | 'ignore') => mutate(`/tasks/failures/batch-${action}`, { groupId: group.id, groupKey: group.key, filter: toParams() }),
    batchRetry: (ids: string[]) => mutate('/tasks/failures/batch-retry', { ids }),
    batchIgnore: (ids: string[]) => mutate('/tasks/failures/batch-ignore', { ids }),
  }
}
