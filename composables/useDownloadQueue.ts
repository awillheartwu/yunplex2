import type { DownloadTask, QueueStatus } from '~~/server/lib/download/queue'
import { sseSubscribe, sseConnected } from './sse'
import { useIntervalFn, useThrottleFn } from './useTiming'

interface DownloadQueueOptions {
  liveRunId?: Ref<string | null | undefined>
  liveLimit?: number
}

/**
 * Download queue — SSE-first with polling fallback.
 * Exposes the live queue projection used by Task Center.
 */
export function useDownloadQueue(options: DownloadQueueOptions = {}) {
  const api = useApi()
  const liveRunId = options.liveRunId
  const liveLimit = options.liveLimit ?? 12
  const resolvedLiveRunId = computed(() => liveRunId?.value || null)

  const queueStatus = ref<QueueStatus>({ pending: 0, downloading: 0, tagging: 0, done: 0, failed: 0, total: 0 })
  const liveTasks = ref<DownloadTask[]>([])
  const loading = ref(false)
  const error = ref('')

  const unsubs: Array<() => void> = []

  async function fetchAll() {
    loading.value = true
    error.value = ''
    try {
      const taskParams = {
        status: resolvedLiveRunId.value ? 'pending,downloading,tagging,done' : 'pending,downloading,tagging',
        limit: String(liveLimit),
        ...(resolvedLiveRunId.value ? { runId: resolvedLiveRunId.value } : {}),
      }
      const [status, live] = await Promise.all([
        api.get<QueueStatus>('/downloads/queue-status'),
        api.get<{ items: DownloadTask[] }>('/downloads/tasks', taskParams),
      ])
      queueStatus.value = status
      liveTasks.value = live.items
    } catch (err) {
      error.value = err instanceof Error ? err.message : '下载队列加载失败'
    } finally {
      loading.value = false
    }
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

  if (liveRunId) {
    watch(resolvedLiveRunId, () => {
      void fetchAll()
    })
  }

  onUnmounted(() => {
    stopPolling()
    cancelThrottledFetch()
    for (const unsub of unsubs) unsub()
  })

  return {
    queueStatus, liveTasks, loading, error, fetchAll,
  }
}
