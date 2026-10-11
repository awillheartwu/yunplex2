import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { LogEntry, LogLevel } from '~~/server/lib/log/types'
import { sseSubscribe } from '~~/composables/sse'
import { createLatestAsyncGuard, createThrottledFunction } from '~~/composables/useTiming'
import { clampPage, pageCount } from '~/lib/pagination'

const PAGE_SIZE = 50
/** A shrinking log retention window can move the current page past the end; refetch the last valid page. */
const MAX_CLAMP_FETCHES = 2

export interface LogsPage {
  items: LogEntry[]
  total: number
}

export interface LogsApi {
  get<T>(path: string, params?: Record<string, string>): Promise<T>
}

interface UseSystemLogsOptions {
  api?: LogsApi
  pageSize?: number
  registerLifecycle?: boolean
}

export function useSystemLogs(options: UseSystemLogsOptions = {}) {
  const api = options.api || useApi()
  const pageSize = options.pageSize ?? PAGE_SIZE
  const logs = ref<LogEntry[]>([])
  const total = ref(0)
  const error = ref('')
  const page = ref(1)
  const loading = ref(false)
  const activeFilter = ref<LogLevel | ''>('')
  const pendingCount = ref(0)
  const fetchGuard = createLatestAsyncGuard()
  const pendingRealtimeLogs: LogEntry[] = []
  let disposed = false
  let loadedFilter: LogLevel | '' | null = null

  const pageCountValue = computed(() => pageCount(total.value, pageSize))

  const filters: Array<{ label: string; value: LogLevel | '' }> = [
    { label: '全部', value: '' },
    { label: '信息', value: 'info' },
    { label: '警告', value: 'warn' },
    { label: '错误', value: 'error' },
  ]

  function params(targetPage: number): Record<string, string> {
    const result: Record<string, string> = { limit: String(pageSize), offset: String((targetPage - 1) * pageSize) }
    if (activeFilter.value) result.level = activeFilter.value
    return result
  }

  /**
   * Loads one page. The refresh button keeps the current page, a level change starts at
   * page 1, and a failure keeps the page and rows that are already visible.
   */
  async function loadLogs(target: number) {
    if (disposed) return
    const token = fetchGuard.next()
    const signature = activeFilter.value
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
        const response = await api.get<LogsPage>('/logs', params(requested))
        if (!fetchGuard.isLatest(token)) return
        const lastPage = pageCount(response.total, pageSize)
        if (requested > lastPage) {
          requested = lastPage
          continue
        }
        const buffered = pendingRealtimeLogs.splice(0)
        const knownIds = new Set(response.items.map(item => item.id))
        const newEntries = buffered.filter(item => !knownIds.has(item.id))
        logs.value = requested === 1 ? [...newEntries.reverse(), ...response.items].slice(0, pageSize) : response.items
        total.value = response.total + (requested === 1 ? newEntries.length : 0)
        if (requested !== 1) pendingCount.value += buffered.length
        page.value = requested
        loadedFilter = signature
        if (requested === 1) pendingCount.value = 0
        return
      }
      if (fetchGuard.isLatest(token)) error.value = '数据正在变化，请刷新后重试'
    } catch (err) {
      if (fetchGuard.isLatest(token)) error.value = err instanceof Error ? err.message : '请稍后重试'
    } finally {
      if (fetchGuard.isLatest(token)) { loading.value = false; flushRealtimeLogs() }
    }
  }

  /** Refresh stays on the current page; the level filter restarts at page 1. */
  async function fetchLogs(): Promise<void> {
    await loadLogs(page.value)
  }

  async function goToPage(target: number): Promise<void> {
    await loadLogs(target)
  }

  async function setFilter(level: LogLevel | ''): Promise<void> {
    activeFilter.value = level
    pendingRealtimeLogs.length = 0
    pendingCount.value = 0
    await loadLogs(1)
  }

  /** Live entries only extend the first page; while reading history they are counted instead. */
  function flushRealtimeLogs() {
    if (loading.value || pendingRealtimeLogs.length === 0 || loadedFilter !== activeFilter.value) return
    const known = new Set(logs.value.map(entry => entry.id))
    const nextLogs = pendingRealtimeLogs.splice(0).reverse().filter(entry => !known.has(entry.id))
    total.value += nextLogs.length
    if (page.value !== 1) {
      pendingCount.value += nextLogs.length
      return
    }
    logs.value = [...nextLogs, ...logs.value].slice(0, pageSize)
  }

  const realtimeBatch = createThrottledFunction(flushRealtimeLogs, 80)
  function enqueueRealtimeLog(data: Record<string, unknown>) {
    if (disposed) return
    const entry = data as unknown as LogEntry
    if (logs.value.some(item => item.id === entry.id) || pendingRealtimeLogs.some(item => item.id === entry.id)) return
    if (activeFilter.value && entry.level !== activeFilter.value) return
    pendingRealtimeLogs.push(entry)
    realtimeBatch.run()
  }

  /** Return to the newest entries and clear the pending counter. */
  async function showLatest() {
    await loadLogs(1)
  }

  function levelClass(level: LogLevel): string {
    if (level === 'error') return 'system-log-row__level--error'
    if (level === 'warn') return 'system-log-row__level--warn'
    return 'system-log-row__level--info'
  }

  function formatTime(timestamp: string): string {
    const date = new Date(timestamp)
    const parts = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ]
    const time = [date.getHours(), date.getMinutes(), date.getSeconds()]
      .map(value => String(value).padStart(2, '0'))
      .join(':')
    return `${parts.join('-')} ${time}`
  }

  let unsubscribe: (() => void) | null = null
  let resumeUnsubscribe: (() => void) | null = null
  if (options.registerLifecycle !== false) {
    onMounted(async () => {
      unsubscribe = sseSubscribe('log', enqueueRealtimeLog)
      resumeUnsubscribe = sseSubscribe('resync', () => { void fetchLogs() })
      await fetchLogs()
    })
    onUnmounted(() => {
      disposed = true
      fetchGuard.next()
      pendingRealtimeLogs.length = 0
      realtimeBatch.cancel()
      unsubscribe?.()
      resumeUnsubscribe?.()
      unsubscribe = null
    })
  }

  return {
    activeFilter,
    error,
    fetchLogs,
    filters,
    formatTime,
    goToPage,
    levelClass,
    loading,
    logs,
    page,
    pageCount: pageCountValue,
    pageSize,
    pendingCount,
    receiveRealtimeLog: enqueueRealtimeLog,
    setFilter,
    showLatest,
    total,
  }
}
