import { sseSubscribe, sseConnected } from './sse'

/**
 * Per-source sync — fire-and-forget trigger with SSE-driven state tracking.
 * Uses SSE to clear syncing indicator; falls back to a 30s timeout.
 */
export function useSourceSync() {
  const api = useApi()
  const syncingSourceId = ref<string | null>(null)
  const error = ref<string | null>(null)

  const unsubs: Array<() => void> = []
  let timeout: ReturnType<typeof setTimeout> | null = null

  function clearSyncing() {
    syncingSourceId.value = null
    if (timeout) { clearTimeout(timeout); timeout = null }
  }

  async function syncSource(sourceId: string) {
    error.value = null
    syncingSourceId.value = sourceId
    if (timeout) clearTimeout(timeout)
    // Fallback: clear after 30s if SSE doesn't fire
    timeout = setTimeout(clearSyncing, 30000)
    try {
      await api.post(`/playlist-sources/${sourceId}/sync`)
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
