import { setTimeout as delay } from 'node:timers/promises'
import type { PlexConfig } from './config/types'
import { createPlexHttpClient } from './plex-http'
import { sanitizeDiagnosticMessage } from './domain-error'

export interface PlexScanActivity {
  id: string
  sectionKey: string | null
  active: boolean
  completed: boolean
  observedAt: number
  progress: number | null
  title: string
  subtitle: string
}

export type PlexNotification =
  | { type: 'connection'; connected: boolean }
  | { type: 'activity'; activity: PlexScanActivity; phaseChanged: boolean }
  | { type: 'library'; sectionKey: string | null; playlist: boolean }

interface PlexNotifications {
  ready: Promise<void>
  connected: boolean
  revision: number
  endRevision: number
  activities: Map<string, PlexScanActivity>
  associateScan(id: string, sectionKey: string, since: number): void
  subscribe(listener: (event: PlexNotification) => void): () => void
  close(): Promise<void>
}

const streams = new Map<string, { stream: PlexNotifications; references: number }>()

/** The daemon and in-flight scans share one connection for the same server/account. */
export function acquirePlexNotifications(config: PlexConfig) {
  const key = JSON.stringify([config.server, config.port, config.token])
  let entry = streams.get(key)
  if (!entry) {
    entry = { stream: createStream(config), references: 0 }
    streams.set(key, entry)
  }
  entry.references++
  const owned = entry
  let released = false
  return {
    stream: owned.stream,
    async release() {
      if (released) return
      released = true
      if (--owned.references > 0) return
      if (streams.get(key) === owned) streams.delete(key)
      await owned.stream.close()
    },
  }
}

function createStream(config: PlexConfig): PlexNotifications {
  const controller = new AbortController()
  const listeners = new Set<(event: PlexNotification) => void>()
  const scopes = new Map<string, { sectionKey: string; since: number }>()
  let firstAttemptDone!: () => void
  const ready = new Promise<void>(resolve => { firstAttemptDone = resolve })
  const stream: PlexNotifications = {
    ready, connected: false, revision: 0, endRevision: 0, activities: new Map(),
    associateScan(id, sectionKey, since) {
      if (scopes.size >= 64) scopes.delete(scopes.keys().next().value!)
      scopes.set(id, { sectionKey, since })
      const activity = stream.activities.get(id)
      if (activity && activity.observedAt >= since && !activity.sectionKey) {
        activity.sectionKey = sectionKey
        stream.revision++
        notify({ type: 'activity', activity, phaseChanged: true })
      }
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    async close() { controller.abort(); await reading; listeners.clear(); stream.activities.clear(); scopes.clear() },
  }
  function notify(event: PlexNotification) {
    for (const listener of listeners) {
      try { listener(event) } catch { /* One consumer cannot interrupt the stream. */ }
    }
  }
  function accept(data: string, eventName: string) {
    let payload: Record<string, unknown> | null
    try { payload = object(JSON.parse(data)) } catch { return }
    const container = object(payload?.NotificationContainer) ?? payload
    if (!container) return
    const raw = container.ActivityNotification ?? (eventName === 'activity' && container.event ? container : null)
    for (const value of array(raw)) {
      const entry = object(value)
      const activity = object(entry?.Activity)
      const id = String(entry?.uuid ?? activity?.uuid ?? '')
      const previous = stream.activities.get(id)
      if (!id || (activity?.type !== 'library.update.section' && !previous)) continue
      if (!['started', 'updated', 'ended'].includes(String(entry?.event))) continue
      const completed = entry?.event === 'ended'
      const context = object(activity?.Context)
      const section = context?.librarySectionID ?? context?.sectionID
        ?? String(context?.key ?? '').match(/^\/library\/sections\/([^/?]+)/)?.[1]
      const scope = scopes.get(id)
      const sectionKey = section != null ? String(section) : previous?.sectionKey
        ?? (scope && performance.now() >= scope.since ? scope.sectionKey : null)
      const phaseChanged = !previous || previous.completed !== completed || previous.sectionKey !== sectionKey
      const progress = activity?.progress == null ? previous?.progress ?? null : Number(activity.progress)
      const next: PlexScanActivity = {
        id, sectionKey, active: !completed, completed,
        observedAt: phaseChanged ? performance.now() : previous.observedAt,
        progress: progress !== null && Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : null,
        title: safeText(activity?.title ?? previous?.title),
        subtitle: safeText(activity?.subtitle ?? previous?.subtitle),
      }
      if (stream.activities.size >= 64 && !previous) stream.activities.delete(stream.activities.keys().next().value!)
      stream.activities.set(id, next)
      if (phaseChanged) stream.revision++
      if (completed && phaseChanged) stream.endRevision++
      notify({ type: 'activity', activity: next, phaseChanged })
    }
    const entries = container.TimelineEntry ?? (eventName === 'timeline' ? container : null)
    for (const value of array(entries)) {
      const entry = object(value)
      if (!entry || ![0, 5, 9].includes(Number(entry.state))) continue
      const type = Number(entry.type)
      if (![8, 9, 10, 15].includes(type)) continue
      stream.revision++
      const section = entry.sectionID ?? entry.librarySectionID
      notify({ type: 'library', sectionKey: section == null ? null : String(section), playlist: type === 15 })
    }
  }

  async function consume(response: Response, signal: AbortSignal, onData: () => void) {
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let pending = ''
    let data: string[] = []
    let size = 0
    let eventName = ''
    try {
      while (!signal.aborted) {
        const chunk = await reader.read()
        if (chunk.done) break
        onData()
        pending += decoder.decode(chunk.value, { stream: true })
        if (pending.length + size > 256_000) break
        let end: number
        while ((end = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, end).replace(/\r$/, '')
          pending = pending.slice(end + 1)
          if (!line) {
            if (data.length) accept(data.join('\n'), eventName)
            data = []; size = 0; eventName = ''
          } else if (line.startsWith('data:')) {
            const value = line.slice(5).replace(/^ /, '')
            data.push(value); size += value.length
          } else if (line.startsWith('event:')) eventName = line.slice(6).trim()
        }
      }
    } finally {
      await reader.cancel().catch(() => undefined)
      reader.releaseLock()
    }
  }

  async function run() {
    let retryMs = 1000
    while (!controller.signal.aborted) {
      const connection = new AbortController()
      const signal = AbortSignal.any([controller.signal, connection.signal])
      let timeout = setTimeout(() => connection.abort(), 5000)
      const resetIdleTimeout = () => {
        clearTimeout(timeout)
        timeout = setTimeout(() => connection.abort(), 90_000)
        timeout.unref()
      }
      try {
        const response = await createPlexHttpClient(config).openEventStream(signal)
        if (!response.body) throw new Error('Empty Plex stream')
        stream.connected = true
        stream.revision++
        notify({ type: 'connection', connected: true })
        firstAttemptDone()
        resetIdleTimeout()
        await consume(response, signal, () => { retryMs = 1000; resetIdleTimeout() })
      } catch { /* Polling remains authoritative; reconnect below. */ }
      finally {
        clearTimeout(timeout)
        connection.abort()
        stream.connected = false
        for (const [id, activity] of stream.activities) if (activity.active) stream.activities.delete(id)
        stream.revision++
        notify({ type: 'connection', connected: false })
        firstAttemptDone()
      }
      if (controller.signal.aborted) break
      await delay(retryMs, undefined, { signal: controller.signal, ref: false }).catch(() => undefined)
      retryMs = Math.min(30_000, retryMs * 2)
    }
  }
  const reading = run()
  return stream
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}
function array(value: unknown): unknown[] { return value == null ? [] : Array.isArray(value) ? value : [value] }
function safeText(value: unknown): string { return typeof value === 'string' ? (sanitizeDiagnosticMessage(value) ?? '').slice(0, 240) : '' }
