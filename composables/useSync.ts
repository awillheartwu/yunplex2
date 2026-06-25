import type { SyncState } from '~~/server/lib/log/types'
import { sseSubscribe, sseConnected } from './sse'
import { createIntervalFunction, createThrottledFunction } from './useTiming'

const sharedState = ref<SyncState | null>(null)
const sharedLoading = ref(false)
const sharedError = ref<string | null>(null)
const isSseConnected = computed(() => sseConnected.value)

let sharedApi: ReturnType<typeof useApi> | null = null
let activeConsumers = 0
let subscriptionsReady = false
let sseConnectionWatcherStop: (() => void) | null = null
let fetchInFlight: Promise<void> | null = null
let queuedRefresh = false

const sharedUnsubs: Array<() => void> = []

const sharedPolling = createIntervalFunction(() => {
  void fetchStatusShared()
}, 3000)

const sharedLogRefresh = createThrottledFunction(() => {
  void fetchStatusShared()
}, 800)

function ensureApi() {
  if (!sharedApi) {
    throw new Error('同步状态尚未初始化')
  }
  return sharedApi
}

async function refreshStatusFromServer() {
  const api = ensureApi()
  const serverState = await api.get<SyncState>('/sync/status')

  if (sharedState.value) {
    sharedState.value = {
      ...serverState,
      currentStage: sharedState.value.currentStage === 'repair' ? 'repair' : serverState.currentStage,
    }
    return
  }

  sharedState.value = serverState
}

async function fetchStatusShared() {
  if (fetchInFlight) {
    queuedRefresh = true
    return fetchInFlight
  }

  fetchInFlight = (async () => {
    try {
      await refreshStatusFromServer()
      sharedError.value = null
    } catch (err) {
      sharedError.value = err instanceof Error ? err.message : '获取同步状态失败'
    } finally {
      fetchInFlight = null
      if (queuedRefresh) {
        queuedRefresh = false
        void fetchStatusShared()
      }
    }
  })()

  return fetchInFlight
}

function startPollingShared(intervalMs = 3000) {
  void fetchStatusShared()
  sharedPolling.restart(intervalMs)
}

function stopPollingShared() {
  sharedPolling.stop()
}

function ensureSharedRealtime() {
  if (import.meta.server || subscriptionsReady) return

  subscriptionsReady = true
  sharedUnsubs.push(sseSubscribe('stage-change', (data) => {
    if (!sharedState.value || !data.stage) return
    sharedState.value.currentStage = data.stage as SyncState['currentStage']
    if (typeof data.sourceName === 'string') {
      sharedState.value.currentSourceName = data.sourceName
    }
  }))
  sharedUnsubs.push(sseSubscribe('song-progress', (data) => {
    if (!sharedState.value || !data.songName) return
    sharedState.value.currentSong = data.songName as string
  }))
  sharedUnsubs.push(sseSubscribe('log', () => {
    sharedLogRefresh.run()
  }))

  sseConnectionWatcherStop = watch(sseConnected, (connected) => {
    if (connected) {
      stopPollingShared()
      return
    }

    if (activeConsumers > 0) {
      startPollingShared(5000)
    }
  }, { immediate: true })
}

function teardownSharedRealtime() {
  stopPollingShared()
  sharedLogRefresh.cancel()
  sseConnectionWatcherStop?.()
  sseConnectionWatcherStop = null

  while (sharedUnsubs.length > 0) {
    const unsub = sharedUnsubs.pop()
    unsub?.()
  }

  subscriptionsReady = false
}

/**
 * Sync status — shared singleton source with SSE-first updates and polling fallback.
 * Safe to use from multiple pages/components without duplicating subscriptions or requests.
 */
export function useSyncStatus() {
  sharedApi ??= useApi()

  async function triggerSync(dryRun = false) {
    const api = ensureApi()
    sharedLoading.value = true
    sharedError.value = null

    try {
      await api.post('/sync/trigger', { dryRun })
      if (!sseConnected.value) startPollingShared(2000)
    } catch (err) {
      sharedError.value = err instanceof Error ? err.message : '触发同步失败'
      throw err
    } finally {
      sharedLoading.value = false
    }
  }

  async function cancelSync() {
    const api = ensureApi()
    try {
      await api.post('/sync/cancel')
      await fetchStatusShared()
    } catch (err) {
      sharedError.value = err instanceof Error ? err.message : '取消同步失败'
    }
  }

  onMounted(() => {
    activeConsumers += 1
    ensureSharedRealtime()
  })

  onUnmounted(() => {
    activeConsumers = Math.max(0, activeConsumers - 1)
    if (activeConsumers === 0) {
      teardownSharedRealtime()
    }
  })

  return {
    state: sharedState,
    loading: sharedLoading,
    error: sharedError,
    isSseConnected,
    fetchStatus: fetchStatusShared,
    triggerSync,
    cancelSync,
    startPolling: startPollingShared,
    stopPolling: stopPollingShared,
  }
}

export { useSyncStatus as useSync }
