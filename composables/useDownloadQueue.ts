import type { DownloadTask, QueueStatus } from '~~/server/lib/download/queue'
import { sseSubscribe, sseConnected } from './sse'
import { useIntervalFn, useThrottleFn } from './useTiming'

const PAGE_SIZE = 30

interface DownloadQueueOptions {
  includeHistory?: boolean
}

/**
 * Download queue — SSE-first with polling fallback.
 * Manages queue stats, active/failed/history lists with pagination.
 */
export function useDownloadQueue(options: DownloadQueueOptions = {}) {
  const api = useApi()
  const includeHistory = options.includeHistory ?? true

  const queueStatus = ref<QueueStatus>({ pending: 0, downloading: 0, tagging: 0, done: 0, failed: 0, total: 0 })
  const activeTasks = ref<DownloadTask[]>([])
  const loading = ref(false)

  // Failed
  const failedTasks = ref<DownloadTask[]>([])
  const failedTotal = ref(0)
  const failedOffset = ref(0)
  const failedLoadingMore = ref(false)
  const failedHasMore = computed(() => failedTasks.value.length < failedTotal.value)

  // History
  const historyItems = ref<DownloadTask[]>([])
  const historyEarliestDate = ref<string | null>(null)
  const historyTotal = ref(0)
  const historyOffset = ref(0)
  const historyLoadingMore = ref(false)
  const historyHasMore = computed(() => historyItems.value.length < historyTotal.value)

  // Actions
  const retrying = ref(false)
  const retryingOne = ref<string | null>(null)
  const dateFilter = ref<{ from: string | null; to: string | null }>({ from: null, to: null })
  const historyStatus = ref<'done' | 'failed' | 'done,failed'>('done')

  function dateParams(search?: string): Record<string, string> {
    const p: Record<string, string> = {
      status: historyStatus.value,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    }
    if (dateFilter.value.from) p.from = dateFilter.value.from
    if (dateFilter.value.to) p.to = dateFilter.value.to
    if (search) p.search = search
    return p
  }

  const unsubs: Array<() => void> = []

  const historySearch = ref('')

  async function fetchAll() {
    loading.value = true
    try {
      const dp = dateParams(historySearch.value || undefined)
      const historyRequest = includeHistory
        ? api.get<{ items: DownloadTask[]; total: number; earliestDate: string | null }>('/downloads/history', { limit: String(PAGE_SIZE), offset: '0', ...dp })
        : Promise.resolve(null)
      const [status, active, failed, history] = await Promise.all([
        api.get<QueueStatus>('/downloads/queue-status'),
        api.get<{ items: DownloadTask[] }>('/downloads/tasks', { status: 'pending,downloading,tagging', limit: '50' }),
        api.get<{ items: DownloadTask[]; total: number }>('/downloads/tasks', { status: 'failed', limit: String(PAGE_SIZE), offset: '0' }),
        historyRequest,
      ])
      queueStatus.value = status
      activeTasks.value = active.items
      failedTasks.value = failed.items
      failedTotal.value = failed.total
      failedOffset.value = 0
      if (history) {
        historyItems.value = history.items
        historyTotal.value = history.total
        historyEarliestDate.value = history.earliestDate ?? null
        historyOffset.value = 0
      }
    } catch { /* ignore */ } finally {
      loading.value = false
    }
  }

  async function loadMoreFailed() {
    if (failedLoadingMore.value || !failedHasMore.value) return
    failedLoadingMore.value = true
    try {
      const newOffset = failedOffset.value + PAGE_SIZE
      const res = await api.get<{ items: DownloadTask[]; total: number }>('/downloads/tasks', { status: 'failed', limit: String(PAGE_SIZE), offset: String(newOffset) })
      failedTasks.value = [...failedTasks.value, ...res.items]
      failedTotal.value = res.total
      failedOffset.value = newOffset
    } catch { /* ignore */ } finally {
      failedLoadingMore.value = false
    }
  }

  async function loadMoreHistory() {
    if (historyLoadingMore.value || !historyHasMore.value) return
    historyLoadingMore.value = true
    try {
      const newOffset = historyOffset.value + PAGE_SIZE
      const dp = dateParams(historySearch.value || undefined)
      const res = await api.get<{ items: DownloadTask[]; total: number }>('/downloads/history', { limit: String(PAGE_SIZE), offset: String(newOffset), ...dp })
      historyItems.value.push(...res.items)
      historyTotal.value = res.total
      historyOffset.value = newOffset
    } catch { /* ignore */ } finally {
      historyLoadingMore.value = false
    }
  }

  async function retryOne(id: string) {
    retryingOne.value = id
    try { await api.post(`/downloads/tasks/${id}/retry`); await fetchAll() }
    finally { retryingOne.value = null }
  }

  async function retryAll() {
    retrying.value = true
    try { await api.post('/downloads/tasks/retry-failed'); await fetchAll() }
    finally { retrying.value = false }
  }

  async function clearAll() {
    await api.del('/downloads/tasks')
    await fetchAll()
  }

  async function clearQueue() {
    await api.del('/downloads/tasks?scope=queue')
    await fetchAll()
  }

  async function deleteOne(id: string) {
    await api.del(`/downloads/tasks/${id}`)
    await fetchAll()
  }

  const polling = useIntervalFn(() => { void fetchAll() }, 5000)

  function startPolling() {
    polling.start()
  }

  function stopPolling() {
    polling.stop()
  }

  const isSseConnected = computed(() => sseConnected.value)
  const { run: throttledFetch, cancel: cancelThrottledFetch } = useThrottleFn(() => { void fetchAll() }, 2000)

  onMounted(() => {
    // Throttled SSE-driven refresh — queue-update fires per song progress (dozens/sec)
    unsubs.push(sseSubscribe('queue-update', throttledFetch))

    fetchAll()
    if (!sseConnected.value) startPolling()
  })

  // Switch between SSE and polling based on connection state
  watch(isSseConnected, (connected) => {
    if (connected) stopPolling()
    else startPolling()
  })

  onUnmounted(() => {
    stopPolling()
    cancelThrottledFetch()
    for (const unsub of unsubs) unsub()
  })

  return {
    queueStatus, activeTasks, loading,
    failedTasks, failedTotal, failedHasMore, failedLoadingMore, loadMoreFailed,
    historyItems, historyEarliestDate, historyTotal, historyHasMore, historyLoadingMore, loadMoreHistory,
    retrying, retryingOne, retryOne, retryAll, clearAll, clearQueue, deleteOne,
    dateFilter, historySearch, historyStatus, fetchAll,
  }
}
