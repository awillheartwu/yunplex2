import { sseSubscribe, sseConnected } from './sse'

/**
 * Per-source sync — fire-and-forget trigger with SSE-driven state tracking.
 * Use on the sources page. The syncing state is optimistic:
 * set when the user clicks sync, cleared when SSE reports stage → idle.
 */
export function useSourceSync() {
  const api = useApi()
  const syncingSourceId = ref<string | null>(null)
  const error = ref<string | null>(null)

  const unsubs: Array<() => void> = []

  async function syncSource(sourceId: string) {
    error.value = null
    syncingSourceId.value = sourceId
    try {
      await api.post(`/playlist-sources/${sourceId}/sync`)
    } catch (err) {
      syncingSourceId.value = null
      error.value = err instanceof Error ? err.message : '触发同步失败'
      throw err
    }
  }

  onMounted(() => {
    // When sync finishes (stage goes back to idle), clear the syncing indicator
    unsubs.push(sseSubscribe('stage-change', (data) => {
      if (data.stage === 'idle') {
        syncingSourceId.value = null
      }
    }))
  })

  onUnmounted(() => {
    for (const unsub of unsubs) unsub()
  })

  return { syncingSourceId, error, syncSource, isSseConnected: computed(() => sseConnected.value) }
}
