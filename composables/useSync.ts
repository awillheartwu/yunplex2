import type { SyncState } from '~~/server/lib/log/types'

export function useSync() {
  const api = useApi()
  const state = ref<SyncState | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  let pollTimer: ReturnType<typeof setInterval> | null = null

  async function fetchStatus() {
    try {
      state.value = await api.get<SyncState>('/sync/status')
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
      // Fire-and-forget: start rapid polling to catch the running state
      startPolling(2000)
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

  onUnmounted(() => stopPolling())

  return {
    state,
    loading,
    error,
    fetchStatus,
    triggerSync,
    cancelSync,
    startPolling,
    stopPolling,
  }
}
