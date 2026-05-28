export type SyncEventType = 'stage-change' | 'song-progress' | 'log' | 'queue-update'

export interface SyncEvent {
  type: SyncEventType
  data: Record<string, unknown>
  timestamp: string
}

type EventHandler = (event: SyncEvent) => void
type ClientEntry = { handler: EventHandler; lastPing: number }
const clients = new Set<ClientEntry>()

// Clean up zombie clients every 5 minutes
const ZOMBIE_TIMEOUT_MS = 5 * 60 * 1000
setInterval(() => {
  const now = Date.now()
  for (const entry of clients) {
    if (now - entry.lastPing > ZOMBIE_TIMEOUT_MS) {
      clients.delete(entry)
    }
  }
}, ZOMBIE_TIMEOUT_MS).unref()

export function emitEvent(event: SyncEvent): void {
  for (const entry of clients) {
    try { entry.handler(event) } catch { /* don't let one bad client break others */ }
  }
}

export function subscribe(fn: EventHandler): () => void {
  const entry: ClientEntry = { handler: fn, lastPing: Date.now() }
  clients.add(entry)
  return () => { clients.delete(entry) }
}

/** Keep-alive ping from the SSE endpoint to prevent zombie timeout */
export function ping(client: EventHandler): void {
  for (const entry of clients) {
    if (entry.handler === client) {
      entry.lastPing = Date.now()
      return
    }
  }
}
