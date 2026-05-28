// Module-level SSE singleton — one EventSource for the entire app.
// Composables subscribe to typed events; the singleton handles connection lifecycle.

export type SseEventType = 'stage-change' | 'song-progress' | 'log' | 'queue-update'

type SseHandler = (data: Record<string, unknown>) => void

let instance: EventSource | null = null
let refCount = 0
const subscribers = new Map<SseEventType, Set<SseHandler>>()

export const sseConnected = ref(false)

function ensureConnection() {
  if (import.meta.server) return
  if (instance && instance.readyState === EventSource.OPEN) return

  // Reopen if closed/errored
  if (instance) {
    instance.close()
    instance = null
  }

  instance = new EventSource('/api/sync/events')

  // Generic dispatcher — routes all incoming events to subscribers
  const dispatch = (type: SseEventType, data: Record<string, unknown>) => {
    const handlers = subscribers.get(type)
    if (!handlers) return
    for (const fn of handlers) {
      try { fn(data) } catch { /* don't let one bad handler break others */ }
    }
  }

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

  instance.onopen = () => { sseConnected.value = true }
  instance.onerror = () => {
    sseConnected.value = false
  }
}

function teardown() {
  if (instance) {
    instance.close()
    instance = null
  }
  sseConnected.value = false
}

export function sseSubscribe(type: SseEventType, handler: SseHandler): () => void {
  if (!subscribers.has(type)) subscribers.set(type, new Set())
  subscribers.get(type)!.add(handler)

  refCount++
  ensureConnection()

  return () => {
    subscribers.get(type)?.delete(handler)
    refCount--
    if (refCount <= 0) {
      refCount = 0
      teardown()
    }
  }
}
