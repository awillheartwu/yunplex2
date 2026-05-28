import type { SyncState } from '~~/server/lib/log/types'
import { sseSubscribe, sseConnected } from './sse'

// Shared state across all useSyncStatus() callers
const sharedState = ref<SyncState | null>(null)

/**
 * Sync status — SSE-first with polling fallback.
 * Use for dashboard, TopBar, or anywhere you need isRunning / currentStage.
 */
export function useSyncStatus() {
  const api = useApi()
  const loading = ref(false)
  const error = ref<string | null>(null)
  const isSseConnected = computed(() => sseConnected.value)

  let pollTimer: ReturnType<typeof setInterval> | null = null
  const unsubs: Array<() => void> = []

  async function fetchStatus() {
    try {
      sharedState.value = await api.get<SyncState>('/sync/status')
      error.value = null
    } catch (err) {
      error.value = err instanceof Error ? err.message : '获取同步状态失败'
    }
  }

  async function triggerSync(dryRun = false) {
    loading.value = true
    error.value = null
    try {
      await api.post('/sync/trigger', { dryRun })
      if (!sseConnected.value) startPolling(2000)
    } catch (err) {
      error.value = err instanceof Error ? err.message : '触发同步失败'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function cancelSync() {
    try {
      await api.post('/sync/cancel')
      await fetchStatus()
    } catch (err) {
      error.value = err instanceof Error ? err.message : '取消同步失败'
    }
  }

  function startPolling(intervalMs = 3000) {
    stopPolling()
    fetchStatus()
    pollTimer = setInterval(fetchStatus, intervalMs)
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  onMounted(() => {
    // Subscribe to SSE for real-time stage/song updates
    unsubs.push(sseSubscribe('stage-change', (data) => {
      if (sharedState.value && data.stage) {
        sharedState.value.currentStage = data.stage as SyncState['currentStage']
      }
    }))
    unsubs.push(sseSubscribe('song-progress', (data) => {
      if (sharedState.value && data.songName) {
        sharedState.value.currentSong = data.songName as string
      }
    }))
    unsubs.push(sseSubscribe('log', () => {
      // Log events trigger a full status refresh to keep stats in sync
      fetchStatus()
    }))

    // Fallback polling if SSE is down
    if (!sseConnected.value) startPolling(5000)
  })

  onUnmounted(() => {
    stopPolling()
    for (const unsub of unsubs) unsub()
  })

  return {
    state: sharedState, loading, error, isSseConnected,
    fetchStatus, triggerSync, cancelSync,
    startPolling, stopPolling,
  }
}

// Backward-compat alias — existing code imports useSync
export { useSyncStatus as useSync }
