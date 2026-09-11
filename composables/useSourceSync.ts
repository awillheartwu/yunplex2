import { computed, ref, onMounted, onUnmounted } from 'vue'
import { sseSubscribe, sseConnected } from './sse'
import type { SyncMode } from '~~/server/lib/sync/service-state'
import type { SourceRequestsResult, SourceRequestSnapshot } from '~~/server/lib/sync/source-requests'

/** Track the accepted request, never another source's global idle event. */
export function useSourceSync() {
  const api = useApi()
  const syncingSourceId = ref<string | null>(null)
  const requestState = ref<SourceRequestSnapshot | null>(null)
  const error = ref<string | null>(null)
  let requestId: string | null = null
  let expectedSourceId: string | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  let disposed = false
  let refreshing = false
  let unsubscribe: (() => void) | null = null

  async function refresh() {
    const id = requestId
    if (!id || refreshing || disposed) return
    refreshing = true
    try {
      const state = await api.get<SourceRequestSnapshot>(`/source-requests/${encodeURIComponent(id)}`)
      if (disposed || requestId !== id) return
      if (expectedSourceId && state.sourceId !== expectedSourceId) {
        requestId = null
        if (timer) clearInterval(timer)
        timer = null
        error.value = '该请求不属于当前来源'
        return
      }
      requestState.value = state
      error.value = null
      syncingSourceId.value = state.kind === 'convergence' && state.status === 'running' ? state.sourceId : null
      if (!['pending', 'running'].includes(state.status)) {
        requestId = null
        if (timer) clearInterval(timer)
        timer = null
        if (state.error) error.value = state.error
      }
    } catch (value) {
      if (!disposed && requestId === id) error.value = value instanceof Error ? value.message : '读取来源请求失败'
    } finally { refreshing = false }
  }

  async function trackRequest(id: string | null, sourceId: string) {
    requestId = id
    expectedSourceId = sourceId
    requestState.value = null
    syncingSourceId.value = null
    error.value = null
    if (timer) clearInterval(timer)
    timer = id && !disposed ? setInterval(() => { void refresh() }, 2500) : null
    await refresh()
  }

  async function syncSource(sourceId: string, body?: { mode?: SyncMode; takeOverExternal?: boolean }) {
    error.value = null
    const result = await api.post<SourceRequestsResult>(`/playlist-sources/${sourceId}/sync`, body ?? { mode: 'normal' })
    const outcome = result.results[0]
    if (outcome?.status === 'busy' || outcome?.status === 'failed') throw new Error(outcome.message)
    if (disposed) return result
    await trackRequest(outcome?.requestId ?? null, sourceId)
    return result
  }

  onMounted(() => {
    unsubscribe = sseSubscribe('stage-change', data => {
      if (data.sourceId === syncingSourceId.value) void refresh()
    })
  })
  onUnmounted(() => {
    disposed = true
    if (timer) clearInterval(timer)
    unsubscribe?.()
  })
  return { requestState, syncingSourceId, error, syncSource, trackRequest, isSseConnected: computed(() => sseConnected.value) }
}
