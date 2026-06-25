import type { JobStatus, TaskRun, TaskRunSummary, TaskRunType } from '~~/server/lib/job/types'

export interface RunFilter {
  type?: TaskRunType | ''
  status?: JobStatus | ''
  sourceId?: string
  search?: string
  from?: string
  to?: string
}

export function useRuns(initial: RunFilter = {}) {
  const api = useApi()
  const items = ref<TaskRunSummary[]>([])
  const total = ref(0)
  const earliestDate = ref<string | null>(null)
  const loading = ref(false)
  const loadingMore = ref(false)
  const filter = ref<RunFilter>({ ...initial })
  const pageSize = 30

  const hasMore = computed(() => items.value.length < total.value)
  const activeRuns = computed(() => items.value.filter(run => run.status === 'running'))

  function params(offset = 0): Record<string, string> {
    const result: Record<string, string> = {
      limit: String(pageSize),
      offset: String(offset),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    }
    if (filter.value.type) result.type = filter.value.type
    if (filter.value.status) result.status = filter.value.status
    if (filter.value.sourceId) result.sourceId = filter.value.sourceId
    if (filter.value.search) result.search = filter.value.search
    if (filter.value.from) result.from = filter.value.from
    if (filter.value.to) result.to = filter.value.to
    return result
  }

  async function fetch() {
    loading.value = true
    try {
      const response = await api.get<{ items: TaskRunSummary[]; total: number; earliestDate: string | null }>('/runs', params())
      items.value = response.items
      total.value = response.total
      earliestDate.value = response.earliestDate
    } finally {
      loading.value = false
    }
  }

  async function loadMore() {
    if (!hasMore.value || loadingMore.value) return
    loadingMore.value = true
    try {
      const response = await api.get<{ items: TaskRunSummary[]; total: number; earliestDate: string | null }>('/runs', params(items.value.length))
      items.value = [...items.value, ...response.items]
      total.value = response.total
    } finally {
      loadingMore.value = false
    }
  }

  async function get(id: string): Promise<TaskRun> {
    return api.get<TaskRun>(`/runs/${id}`)
  }

  return {
    items,
    total,
    earliestDate,
    loading,
    loadingMore,
    hasMore,
    activeRuns,
    filter,
    fetch,
    loadMore,
    get,
  }
}
