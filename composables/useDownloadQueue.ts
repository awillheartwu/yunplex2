import type { DownloadTask, QueueStatus } from '~~/server/lib/download/queue'
import type { DownloadRecord } from '~~/server/lib/download/store'
import { sseSubscribe, sseConnected } from './sse'

const PAGE_SIZE = 30

/**
 * Download queue — SSE-first with polling fallback.
 * Manages queue stats, active/failed/history lists with pagination.
 */
export function useDownloadQueue() {
  const api = useApi()

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
  const historyItems = ref<DownloadRecord[]>([])
  const historyEarliestDate = ref<string | null>(null)
  const historyTotal = ref(0)
  const historyOffset = ref(0)
  const historyLoadingMore = ref(false)
  const historyHasMore = computed(() => historyItems.value.length < historyTotal.value)

  // Actions
  const retrying = ref(false)
  const retryingOne = ref<string | null>(null)
  const dateFilter = ref<{ from: string | null; to: string | null }>({ from: null, to: null })

  function dateParams(): Record<string, string> {
    const p: Record<string, string> = {}
    if (dateFilter.value.from) p.from = dateFilter.value.from
    if (dateFilter.value.to) p.to = `${dateFilter.value.to}T23:59:59.999Z`
    return p
  }

  let pollTimer: ReturnType<typeof setInterval> | null = null
  const unsubs: Array<() => void> = []

  async function fetchAll() {
    loading.value = true
    try {
      const dp = dateParams()
      const [status, active, failed, history] = await Promise.all([
        api.get<QueueStatus>('/downloads/queue-status'),
        api.get<{ items: DownloadTask[] }>('/downloads/tasks', { status: 'pending,downloading,tagging', limit: '50' }),
        api.get<{ items: DownloadTask[]; total: number }>('/downloads/tasks', { status: 'failed', limit: String(PAGE_SIZE), offset: '0' }),
        api.get<{ items: DownloadRecord[]; total: number; earliestDate: string | null }>('/downloads/history', { limit: String(PAGE_SIZE), offset: '0', ...dp }),
      ])
      queueStatus.value = status
      activeTasks.value = active.items
      failedTasks.value = failed.items
      failedTotal.value = failed.total
      failedOffset.value = 0
      historyItems.value = history.items
      historyTotal.value = history.total
      historyEarliestDate.value = (history as any).earliestDate ?? null
      historyOffset.value = 0
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
      const dp = dateParams()
      const res = await api.get<{ items: DownloadRecord[]; total: number }>('/downloads/history', { limit: String(PAGE_SIZE), offset: String(newOffset), ...dp })
      historyItems.value.push(...res.items)
      historyTotal.value = res.total
      historyOffset.value = newOffset
    } catch { /* ignore */ } finally {
      historyLoadingMore.value = false
    }
  }

  async function retryOne(id: string) {
    retryingOne.value = id
    try { await api.post(`/downloads/tasks/${id}/retry`); await fetchAll() } catch { /* ignore */ }
    finally { retryingOne.value = null }
  }

  async function retryAll() {
    retrying.value = true
    try { await api.post('/downloads/tasks/retry-failed'); await fetchAll() } catch { /* ignore */ }
    finally { retrying.value = false }
  }

  async function clearAll() {
    try { await api.del('/downloads/tasks'); await fetchAll() } catch { /* ignore */ }
  }

  function startPolling() {
    if (pollTimer) return
    pollTimer = setInterval(fetchAll, 5000)
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  }

  const isSseConnected = computed(() => sseConnected.value)

  let pendingFetch: ReturnType<typeof setTimeout> | null = null
  function throttledFetch() {
    if (pendingFetch) return
    pendingFetch = setTimeout(() => { pendingFetch = null; fetchAll() }, 2000)
  }

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
    if (pendingFetch) { clearTimeout(pendingFetch); pendingFetch = null }
    for (const unsub of unsubs) unsub()
  })

  return {
    queueStatus, activeTasks, loading,
    failedTasks, failedTotal, failedHasMore, failedLoadingMore, loadMoreFailed,
    historyItems, historyEarliestDate, historyTotal, historyHasMore, historyLoadingMore, loadMoreHistory,
    retrying, retryingOne, retryOne, retryAll, clearAll,
    dateFilter, fetchAll,
  }
}
