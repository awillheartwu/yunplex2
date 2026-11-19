import { computed, ref } from 'vue'
import type { JobStatus, TaskRun, TaskRunSummary, TaskRunType } from '~~/server/lib/job/types'
import { createLatestAsyncGuard } from '~~/composables/useTiming'
import { clampPage, pageCount } from '~/lib/pagination'

export interface RunFilter {
  type?: TaskRunType | ''
  status?: JobStatus | ''
  sourceId?: string
  search?: string
  from?: string
  to?: string
}

export interface RunsPage {
  items: TaskRunSummary[]
  total: number
  earliestDate: string | null
}

export interface RunsApi {
  get<T>(path: string, params?: Record<string, string>): Promise<T>
}

interface UseRunsOptions {
  api?: RunsApi
  pageSize?: number
}

/** A shrinking result set can move the current page past the end; refetch the last valid page instead of showing an empty one. */
const MAX_CLAMP_FETCHES = 2

export function useRuns(initial: RunFilter = {}, options: UseRunsOptions = {}) {
  const api = options.api || useApi()
  const items = ref<TaskRunSummary[]>([])
  const total = ref(0)
  const earliestDate = ref<string | null>(null)
  const error = ref('')
  const page = ref(1)
  const pageSize = options.pageSize ?? 30
  const loading = ref(false)
  const filter = ref<RunFilter>({ ...initial })
  const fetchGuard = createLatestAsyncGuard()
  let loadedFilter: string | null = null

  const pageCountValue = computed(() => pageCount(total.value, pageSize))
  const activeRuns = computed(() => items.value.filter(run => run.status === 'running' || run.status === 'awaiting_action'))

  function filterSignature(): string {
    const value = filter.value
    return JSON.stringify([value.type || '', value.status || '', value.sourceId || '', value.search || '', value.from || '', value.to || ''])
  }

  function params(targetPage: number): Record<string, string> {
    const result: Record<string, string> = {
      limit: String(pageSize),
      offset: String((targetPage - 1) * pageSize),
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

  /**
   * Loads one page. A changed filter always restarts at page 1, a plain refresh keeps
   * the current page, and a failure keeps the page and rows that are already visible.
   */
  async function loadPage(target: number) {
    const token = fetchGuard.next()
    const signature = filterSignature()
    const filtersChanged = loadedFilter !== null && loadedFilter !== signature
    // Before the first snapshot the known page count is meaningless, so only a loaded
    // result set pre-clamps a jump; otherwise the response decides where the page ends.
    const knownPages = loadedFilter === null ? Number.MAX_SAFE_INTEGER : pageCountValue.value
    let requested = filtersChanged ? 1 : clampPage(target, knownPages)
    loading.value = true
    error.value = ''
    let attempts = 0
    try {
      while (fetchGuard.isLatest(token) && attempts < MAX_CLAMP_FETCHES) {
        attempts += 1
        const response = await api.get<RunsPage>('/runs', params(requested))
        if (!fetchGuard.isLatest(token)) return
        const lastPage = pageCount(response.total, pageSize)
        if (requested > lastPage) {
          requested = lastPage
          continue
        }
        items.value = response.items
        total.value = response.total
        earliestDate.value = response.earliestDate
        page.value = requested
        loadedFilter = signature
        return
      }
      if (fetchGuard.isLatest(token)) error.value = '数据正在变化，请刷新后重试'
    } catch (err) {
      if (fetchGuard.isLatest(token)) error.value = err instanceof Error ? err.message : '无法读取运行记录'
    } finally {
      if (fetchGuard.isLatest(token)) loading.value = false
    }
  }

  /** Refresh keeps the current page; filter changes inside the filter object restart at page 1. */
  async function fetch(): Promise<void> {
    await loadPage(page.value)
  }

  async function goToPage(target: number): Promise<void> {
    await loadPage(target)
  }

  async function get(id: string): Promise<TaskRun> {
    return api.get<TaskRun>(`/runs/${id}`)
  }

  return {
    items,
    total,
    earliestDate,
    error,
    loading,
    page,
    pageSize,
    pageCount: pageCountValue,
    activeRuns,
    filter,
    fetch,
    goToPage,
    get,
  }
}
