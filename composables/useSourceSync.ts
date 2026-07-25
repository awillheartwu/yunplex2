import { sseSubscribe, sseConnected } from './sse'
import { useTimeoutFn } from './useTiming'

/**
 * Per-source sync — fire-and-forget trigger with SSE-driven state tracking.
 * Uses SSE to clear syncing indicator; falls back to a 30s timeout.
 */
export function useSourceSync() {
  const api = useApi()
  const syncingSourceId = ref<string | null>(null)
  const error = ref<string | null>(null)

  const unsubs: Array<() => void> = []

  function clearSyncing() {
    syncingSourceId.value = null
    fallbackClear.cancel()
  }

  const fallbackClear = useTimeoutFn(clearSyncing, 30000)

  async function syncSource(sourceId: string, body?: {
    forceFull?: boolean
    rebuildMatch?: boolean
    redownloadAll?: boolean
    takeOverExternal?: boolean
  }) {
    error.value = null
    syncingSourceId.value = sourceId
    // Fallback: clear after 30s if SSE doesn't fire
    fallbackClear.schedule()
    try {
      await api.post(`/playlist-sources/${sourceId}/sync`, body)
    } catch (err) {
      clearSyncing()
      error.value = err instanceof Error ? err.message : '触发同步失败'
      throw err
    }
  }

  onMounted(() => {
    unsubs.push(sseSubscribe('stage-change', (data) => {
      if (data.stage === 'idle') {
        clearSyncing()
      }
    }))
  })

  onUnmounted(() => {
    clearSyncing()
    for (const unsub of unsubs) unsub()
  })

  return { syncingSourceId, error, syncSource, isSseConnected: computed(() => sseConnected.value) }
}
