import type { PlexConfig } from './config/types'
import { getExternalRequestSignal } from './external-request-context'
import { acquirePlexNotifications } from './plex-notifications'

export interface PlexScanEvents {
  setActivityId(id: string | null, requestedAt: number): void
  getState(): { connected: boolean; active: boolean; completed: boolean; revision: number; endRevision: number }
  waitForChange(revision: number, delayMs: number): Promise<void>
  close(): Promise<void>
}

/** A scan owns a listener, while the daemon keeps the shared connection alive. */
export async function openPlexScanEvents(config: PlexConfig, sectionKey: string): Promise<PlexScanEvents> {
  const signal = getExternalRequestSignal()
  signal?.throwIfAborted()
  const lease = acquirePlexNotifications(config)
  const { stream } = lease
  let activityId: string | null = null
  let requestedAt = Infinity
  const waiters = new Set<() => void>()
  const wake = () => { for (const done of [...waiters]) done() }
  const unsubscribe = stream.subscribe(event => {
    // Progress updates do not turn into extra full-library reads.
    if (event.type !== 'activity' || event.phaseChanged) wake()
  })
  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    signal?.removeEventListener('abort', abort)
    unsubscribe(); wake()
    await lease.release()
  }
  const abort = () => { void close() }
  signal?.addEventListener('abort', abort, { once: true })
  await stream.ready
  if (signal?.aborted) { await close(); signal.throwIfAborted() }
  return {
    setActivityId(id, since) {
      activityId = id?.trim() || null; requestedAt = since
      // Refresh replies can identify a scan whose notification omits its section.
      if (activityId) stream.associateScan(activityId, sectionKey, since)
      wake()
    },
    getState() {
      const candidates = activityId
        ? [stream.activities.get(activityId)].filter(entry => entry !== undefined)
        : [...stream.activities.values()].filter(entry => entry.sectionKey === sectionKey)
      const relevant = candidates.filter(entry => entry.observedAt >= requestedAt)
      const active = stream.connected && relevant.some(entry => entry.active)
      return { connected: stream.connected, active, completed: !active && relevant.some(entry => entry.completed), revision: stream.revision, endRevision: stream.endRevision }
    },
    waitForChange(since, delayMs) {
      if (closed || !stream.connected || stream.revision !== since || signal?.aborted) return Promise.resolve()
      return new Promise(resolve => {
        const done = () => { clearTimeout(timer); waiters.delete(done); resolve() }
        const timer = setTimeout(done, Math.max(0, delayMs))
        waiters.add(done)
      })
    },
    close,
  }
}
