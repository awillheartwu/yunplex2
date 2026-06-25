import type {
  FailureRecord,
  FailureRecordStatus,
} from '~~/server/lib/tasks/failure-records'
import type { TaskRunType } from '~~/server/lib/job/types'

export interface FailureFilter {
  status?: FailureRecordStatus
  type?: TaskRunType | ''
  failureKind?: string
  sourceId?: string
  search?: string
  from?: string
  to?: string
}

export function useFailures() {
  const api = useApi()
  const items = ref<FailureRecord[]>([])
  const total = ref(0)
  const loading = ref(false)
  const loadingMore = ref(false)
  const limit = 50
  const filter = ref<FailureFilter>({ status: 'open' })
  const hasMore = computed(() => items.value.length < total.value)

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
    if (filter.value.search) params.search = filter.value.search
    if (filter.value.from) params.from = filter.value.from
    if (filter.value.to) params.to = filter.value.to
    return params
  }

  async function fetch() {
    loading.value = true
    try {
      const response = await api.get<{ items: FailureRecord[]; total: number }>('/tasks/failures', toParams())
      items.value = response.items
      total.value = response.total
    } catch {
      items.value = []
      total.value = 0
    } finally {
      loading.value = false
    }
  }

  async function loadMore() {
    if (!hasMore.value || loadingMore.value) return
    loadingMore.value = true
    try {
      const response = await api.get<{ items: FailureRecord[]; total: number }>('/tasks/failures', toParams(items.value.length))
      items.value = [...items.value, ...response.items]
      total.value = response.total
    } finally {
      loadingMore.value = false
    }
  }

  async function mutate(endpoint: string, ids: string[]): Promise<{ count: number; msg: string }> {
    if (ids.length === 0) return { count: 0, msg: '没有选择问题' }
    try {
      const response = await api.rawPost<{ count: number }>(endpoint, { ids })
      await fetch()
      return { count: response.data?.count ?? 0, msg: response.msg || '' }
    } catch {
      return { count: 0, msg: '操作失败，请稍后重试' }
    }
  }

  return {
    items,
    total,
    loading,
    loadingMore,
    hasMore,
    filter,
    fetch,
    loadMore,
    batchRetry: (ids: string[]) => mutate('/tasks/failures/batch-retry', ids),
    batchIgnore: (ids: string[]) => mutate('/tasks/failures/batch-ignore', ids),
    batchReopen: (ids: string[]) => mutate('/tasks/failures/batch-reopen', ids),
  }
}
