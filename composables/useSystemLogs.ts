import type { LogEntry, LogLevel } from '~~/server/lib/log/types'
import { sseSubscribe } from '~~/composables/sse'
import { createLatestAsyncGuard, useThrottleFn } from '~~/composables/useTiming'

const PAGE_SIZE = 50

export function useSystemLogs() {
  const api = useApi()
  const logs = ref<LogEntry[]>([])
  const total = ref(0)
  const offset = ref(0)
  const loading = ref(false)
  const loadingMore = ref(false)
  const activeFilter = ref<LogLevel | ''>('')
  const fetchGuard = createLatestAsyncGuard()
  const pendingRealtimeLogs: LogEntry[] = []
  const hasMore = computed(() => logs.value.length < total.value)

  const filters: Array<{ label: string; value: LogLevel | '' }> = [
    { label: '全部', value: '' },
    { label: '信息', value: 'info' },
    { label: '警告', value: 'warn' },
    { label: '错误', value: 'error' },
  ]

  async function fetchLogs() {
    const token = fetchGuard.next()
    loading.value = true
    loadingMore.value = false
    offset.value = 0
    try {
      const params: Record<string, string> = { limit: String(PAGE_SIZE) }
      if (activeFilter.value) params.level = activeFilter.value
      const response = await api.get<{ items: LogEntry[]; total: number }>('/logs', params)
      if (!fetchGuard.isLatest(token)) return
      logs.value = response.items
      total.value = response.total
    } finally {
      if (fetchGuard.isLatest(token)) loading.value = false
    }
  }

  async function loadMore() {
    if (loadingMore.value || !hasMore.value) return
    const token = fetchGuard.next()
    loadingMore.value = true
    try {
      const nextOffset = offset.value + PAGE_SIZE
      const params: Record<string, string> = { limit: String(PAGE_SIZE), offset: String(nextOffset) }
      if (activeFilter.value) params.level = activeFilter.value
      const response = await api.get<{ items: LogEntry[]; total: number }>('/logs', params)
      if (!fetchGuard.isLatest(token)) return
      logs.value = [...logs.value, ...response.items]
      total.value = response.total
      offset.value = nextOffset
    } finally {
      if (fetchGuard.isLatest(token)) loadingMore.value = false
    }
  }

  function setFilter(level: LogLevel | '') {
    activeFilter.value = level
    pendingRealtimeLogs.length = 0
    void fetchLogs()
  }

  function flushRealtimeLogs() {
    if (pendingRealtimeLogs.length === 0) return
    const nextLogs = pendingRealtimeLogs.splice(0).reverse()
    logs.value = [...nextLogs, ...logs.value]
    total.value += nextLogs.length
  }

  const realtimeBatch = useThrottleFn(flushRealtimeLogs, 80)
  function enqueueRealtimeLog(data: Record<string, unknown>) {
    const entry = data as unknown as LogEntry
    if (activeFilter.value && entry.level !== activeFilter.value) return
    pendingRealtimeLogs.push(entry)
    realtimeBatch.run()
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
  onMounted(async () => {
    await fetchLogs()
    unsubscribe = sseSubscribe('log', enqueueRealtimeLog)
  })
  onUnmounted(() => {
    realtimeBatch.flush()
    unsubscribe?.()
    unsubscribe = null
  })

  return {
    activeFilter,
    fetchLogs,
    filters,
    formatTime,
    hasMore,
    levelClass,
    loading,
    loadingMore,
    loadMore,
    logs,
    setFilter,
    total,
  }
}
