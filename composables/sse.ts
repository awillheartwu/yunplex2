// Module-level SSE singleton — one EventSource for the entire app.
// Composables subscribe to typed events; the singleton handles connection lifecycle.
import { ref } from 'vue'

export type SseEventType = 'stage-change' | 'song-progress' | 'log' | 'queue-update' | 'song-retry-progress' | 'repair-progress' | 'resync'

type SseHandler = (data: Record<string, unknown>) => void

let instance: EventSource | null = null
let refCount = 0
const subscribers = new Map<SseEventType, Set<SseHandler>>()
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

export const sseConnected = ref(false)

function dispatch(type: SseEventType, data: Record<string, unknown>) {
  for (const handler of subscribers.get(type) || []) {
    try { handler(data) } catch { /* isolate subscribers */ }
  }
}

function resume() {
  if (document.visibilityState === 'hidden') return
  ensureConnection()
  // Read authoritative snapshots even when a background connection stayed open.
  dispatch('resync', {})
}

function suspend() {
  if (reconnectTimer) clearTimeout(reconnectTimer)
  reconnectTimer = null
  instance?.close()
  instance = null
  sseConnected.value = false
}

function ensureConnection() {
  if (import.meta.server) return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  if (!refCount || (instance && instance.readyState !== EventSource.CLOSED)) return
  if (reconnectTimer) clearTimeout(reconnectTimer)
  reconnectTimer = null

  // Reopen if closed/errored
  if (instance) {
    instance.close()
    instance = null
  }

  const connection = new EventSource('/api/sync/events')
  instance = connection
  sseConnected.value = false

  instance.addEventListener('stage-change', (e: MessageEvent) => {
    try { dispatch('stage-change', JSON.parse(e.data)) } catch { /* ignore */ }
  })
  instance.addEventListener('song-progress', (e: MessageEvent) => {
    try { dispatch('song-progress', JSON.parse(e.data)) } catch { /* ignore */ }
  })
  instance.addEventListener('log', (e: MessageEvent) => {
    try { dispatch('log', JSON.parse(e.data)) } catch { /* ignore */ }
  })
  instance.addEventListener('queue-update', (e: MessageEvent) => {
    try { dispatch('queue-update', JSON.parse(e.data)) } catch { /* ignore */ }
  })
  instance.addEventListener('song-retry-progress', (e: MessageEvent) => {
    try { dispatch('song-retry-progress', JSON.parse(e.data)) } catch { /* ignore */ }
  })
  instance.addEventListener('repair-progress', (e: MessageEvent) => {
    try { dispatch('repair-progress', JSON.parse(e.data)) } catch { /* ignore */ }
  })

  instance.onopen = () => {
    if (instance !== connection) return
    sseConnected.value = true
    dispatch('resync', {})
  }
  instance.onerror = () => {
    if (instance !== connection) return
    sseConnected.value = false
    // CONNECTING already has native retry. CLOSED needs an explicit bounded retry.
    if (connection.readyState === EventSource.CLOSED && !reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        ensureConnection()
      }, 5000)
    }
  }
}

function teardown() {
  suspend()
  if (typeof window !== 'undefined') window.removeEventListener('online', resume)
  if (typeof window !== 'undefined') window.removeEventListener('offline', suspend)
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', resume)
}

export function sseSubscribe(type: SseEventType, handler: SseHandler): () => void {
  if (!subscribers.has(type)) subscribers.set(type, new Set())
  // Each subscription owns its entry, even if a caller reuses the same function.
  const listener: SseHandler = data => handler(data)
  subscribers.get(type)!.add(listener)

  refCount++
  if (refCount === 1) {
    if (typeof window !== 'undefined') window.addEventListener('online', resume)
    if (typeof window !== 'undefined') window.addEventListener('offline', suspend)
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', resume)
  }
  ensureConnection()

  let released = false
  return () => {
    if (released) return
    released = true
    subscribers.get(type)?.delete(listener)
    if (!subscribers.get(type)?.size) subscribers.delete(type)
    refCount--
    if (refCount <= 0) {
      refCount = 0
      teardown()
    }
  }
}
