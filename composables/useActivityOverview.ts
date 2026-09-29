import type { ActivitySnapshot } from '~~/shared/activity'
import { sseSubscribe, sseConnected } from './sse'
import { useIntervalFn, useThrottleFn } from './useTiming'

export function useActivityOverview() {
  const api = useApi()
  const snapshot = ref<ActivitySnapshot | null>(null)
  const loading = ref(false)
  const error = ref('')
  const now = ref(Date.now())
  let disposed = false
  let pending = false
  let inFlight: Promise<void> | null = null
  async function refresh() {
    if (inFlight) { pending = true; return inFlight }
    loading.value = true
    inFlight = (async () => {
      try {
        const result = await api.get<ActivitySnapshot>('/task-center/activity')
        if (!disposed) { snapshot.value = result; error.value = ''; now.value = Date.now() }
      } catch (err) {
        if (!disposed) error.value = err instanceof Error ? err.message : '读取活动失败'
      } finally {
        inFlight = null
        if (!disposed) {
          loading.value = false
          if (pending) { pending = false; void refresh() }
        }
      }
    })()
    return inFlight
  }
  const { run: scheduleRefresh } = useThrottleFn(() => { void refresh() }, 1500)
  // Periodic reconciliation also covers runs that have no dedicated SSE event.
  const polling = useIntervalFn(() => { void refresh() }, 5000)
  const clock = useIntervalFn(() => { now.value = Date.now() }, 1000)
  const unsubs: Array<() => void> = []
  onMounted(() => {
    for (const event of ['queue-update', 'stage-change', 'repair-progress', 'resync'] as const) unsubs.push(sseSubscribe(event, scheduleRefresh))
    void refresh()
    polling.start()
    clock.start()
  })
  onUnmounted(() => { disposed = true; unsubs.forEach(unsubscribe => unsubscribe()); polling.stop(); clock.stop() })
  return { snapshot, loading, error, now, connected: sseConnected, refresh }
}
