import type { AggregatedFailure } from '~~/server/lib/tasks/failure-store'

export interface FailureFilter {
  type?: 'sync' | 'manual' | 'repair'
  failureKind?: string
  sourceId?: string
  search?: string
}

export function useFailures() {
  const api = useApi()
  const items = ref<AggregatedFailure[]>([])
  const total = ref(0)
  const loading = ref(false)
  const page = ref(1)
  const limit = 50

  const hasMore = computed(() => items.value.length < total.value)

  const filter = ref<FailureFilter>({})

  async function fetch() {
    loading.value = true
    page.value = 1
    try {
      const params: Record<string, string> = { limit: String(limit), page: '1' }
      if (filter.value.type) params.type = filter.value.type
      if (filter.value.failureKind) params.failureKind = filter.value.failureKind
      if (filter.value.sourceId) params.sourceId = filter.value.sourceId
      if (filter.value.search) params.search = filter.value.search

      const res = await api.get<{ items: AggregatedFailure[]; total: number }>('/tasks/failures', params)
      items.value = res.items
      total.value = res.total
    } catch {
      items.value = []
      total.value = 0
    } finally {
      loading.value = false
    }
  }

  async function loadMore() {
    if (!hasMore.value || loading.value) return
    loading.value = true
    try {
      const nextPage = page.value + 1
      const params: Record<string, string> = { limit: String(limit), page: String(nextPage) }
      if (filter.value.type) params.type = filter.value.type
      if (filter.value.failureKind) params.failureKind = filter.value.failureKind
      if (filter.value.sourceId) params.sourceId = filter.value.sourceId
      if (filter.value.search) params.search = filter.value.search

      const res = await api.get<{ items: AggregatedFailure[]; total: number }>('/tasks/failures', params)
      items.value = [...items.value, ...res.items]
      total.value = res.total
      page.value = nextPage
    } catch { /* ignore */ } finally {
      loading.value = false
    }
  }

  async function batchRetry(ids: string[]): Promise<{ count: number; msg: string }> {
    try {
      const res = await api.rawPost<{ count: number }>('/tasks/failures/batch-retry', { ids })
      await fetch()
      return { count: res.data?.count ?? 0, msg: res.msg || '' }
    } catch { return { count: 0, msg: '重试请求失败' } }
  }

  async function batchIgnore(ids: string[]): Promise<{ count: number; msg: string }> {
    try {
      const res = await api.rawPost<{ count: number }>('/tasks/failures/batch-ignore', { ids })
      await fetch()
      return { count: res.data?.count ?? 0, msg: res.msg || '' }
    } catch { return { count: 0, msg: '忽略请求失败' } }
  }

  function setFilter(f: FailureFilter) {
    filter.value = { ...filter.value, ...f }
    fetch()
  }

  return {
    items,
    total,
    loading,
    hasMore,
    filter,
    fetch,
    loadMore,
    batchRetry,
    batchIgnore,
    setFilter,
  }
}
