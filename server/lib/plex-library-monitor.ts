import type { PlexLibraryMonitorSnapshot, PlexSourceNotice } from '../../shared/plex-monitor'
import type { AppConfig } from './config/types'
import { createPlexHttpClient } from './plex-http'
import { acquirePlexNotifications, type PlexNotification } from './plex-notifications'
import { getPlaylistSnapshotByRatingKey, initPlexClient, invalidateSectionPathIndex } from './plex-client'
import { listSources } from './playlist/store'
import { withExternalRequestSignal } from './external-request-context'
import { emitEvent } from './sync/events'
import { buildPlexPlaylistFingerprint } from './sync/playlist-fingerprint'
import { enqueueIndexedRecovery, findIndexedRecoverySources } from './sync/plex-index-recovery'

const POLL_MS = 60_000
const PLAYLIST_POLL_MS = 5 * 60_000
interface PlexLibraryMonitor {
  update(): void
  getSnapshot(): PlexLibraryMonitorSnapshot
  getSourceNotice(sourceId: string): PlexSourceNotice | null
  stop(): Promise<void>
}
let current: PlexLibraryMonitor | null = null

const emptySnapshot = (): PlexLibraryMonitorSnapshot => ({
  configured: false, connected: false, section: '', lastCheckedAt: null,
  libraryChangedAt: null, error: null, scan: null,
})

export function getPlexLibraryMonitorSnapshot(): PlexLibraryMonitorSnapshot {
  return current?.getSnapshot() ?? emptySnapshot()
}
export function getPlexSourceNotice(sourceId: string): PlexSourceNotice | null {
  return current?.getSourceNotice(sourceId) ?? null
}
export function updatePlexLibraryMonitor(): void { current?.update() }

/** Events coalesce into authoritative reads; only the source consumer writes playlists. */
export function startPlexLibraryMonitor(getConfig: () => AppConfig, busy: () => boolean, wakeWorker: () => void): PlexLibraryMonitor {
  let snapshot = emptySnapshot()
  let configKey = ''
  let configured: AppConfig | null = null
  let sectionKey: string | null = null
  let lease: ReturnType<typeof acquirePlexNotifications> | null = null
  let unsubscribe: (() => void) | null = null
  let controller = new AbortController()
  let stopped = false
  let checking: Promise<void> | null = null
  let generation = 0
  let requested = 0
  let checked = -1
  let nextPollAt = 0
  let lastPlaylistPollAt = 0
  let followUpPending = true
  let previousContentAt: number | null = null
  let previousScannedAt: number | null = null
  let previousRefreshing = false
  let mediaHint = false
  let lastProgressEventAt = 0
  const notices = new Map<string, PlexSourceNotice>()
  const attemptedRecovery = new Map<string, string>()
  const closing = new Set<Promise<void>>()

  function publish(type: 'plex-scan-progress' | 'plex-library-change') {
    emitEvent({ type, data: { libraryChangedAt: snapshot.libraryChangedAt }, timestamp: new Date().toISOString() })
  }
  function release() {
    unsubscribe?.(); unsubscribe = null
    const old = lease; lease = null
    if (!old) return
    const pending = old.release().finally(() => { closing.delete(pending) })
    closing.add(pending)
  }
  function onNotification(event: PlexNotification) {
    if (event.type === 'connection') {
      requested++
      publish('plex-scan-progress')
      return
    }
    const scope = event.type === 'activity' ? event.activity.sectionKey : event.sectionKey
    if (scope && sectionKey && scope !== sectionKey) return
    if (event.type === 'activity') {
      if (event.activity.active && scope === sectionKey) {
        snapshot.scan = { progress: event.activity.progress, title: event.activity.title, subtitle: event.activity.subtitle }
      }
      if (event.activity.completed && event.phaseChanged) {
        if (scope === sectionKey) snapshot.scan = null
        requested++
      }
      if (Date.now() - lastProgressEventAt > 1000 || event.phaseChanged) {
        lastProgressEventAt = Date.now()
        publish('plex-scan-progress')
      }
    } else {
      if (!event.playlist && scope === sectionKey) mediaHint = true
      requested++
    }
  }

  function update() {
    if (stopped) return
    const config = getConfig()
    configured = config
    const nextKey = JSON.stringify([config.plex, config.download.dir, config.download.plexLibraryPathPrefix, config.sync.enabled])
    if (nextKey === configKey) return
    configKey = nextKey; generation++
    controller.abort(); controller = new AbortController()
    release()
    sectionKey = null; previousContentAt = null; previousScannedAt = null; previousRefreshing = false
    mediaHint = false; followUpPending = true; lastPlaylistPollAt = 0; nextPollAt = 0; requested++; checked = -1
    notices.clear(); attemptedRecovery.clear()
    snapshot = { ...emptySnapshot(), section: config.plex.section,
      configured: Boolean(config.plex.server && config.plex.token && config.plex.section) }
    if (snapshot.configured) {
      lease = acquirePlexNotifications(config.plex)
      unsubscribe = lease.stream.subscribe(onNotification)
    }
    publish('plex-library-change')
  }

  async function check() {
    const config = configured!
    const activeSignal = controller.signal
    const activeGeneration = generation
    const revision = requested
    const checkPlaylists = followUpPending || revision !== checked || Date.now() - lastPlaylistPollAt >= PLAYLIST_POLL_MS
    nextPollAt = Date.now() + POLL_MS
    await withExternalRequestSignal(activeSignal, async () => {
      const response = await createPlexHttpClient(config.plex).query('/library/sections') as {
        MediaContainer?: { Directory?: LibrarySection[] | LibrarySection }
      }
      const raw = response.MediaContainer?.Directory
      const section = (Array.isArray(raw) ? raw : raw ? [raw] : []).find(item => item.type === 'artist' && item.title === config.plex.section)
      if (!section) throw new Error('Plex 音乐库分区不存在，请检查设置')
      sectionKey = String(section.key)
      const contentAt = timestamp(section.contentChangedAt)
      const scannedAt = timestamp(section.scannedAt)
      const refreshing = [true, 1, '1', 'true'].includes(section.refreshing ?? false)
      const changed = mediaHint || (contentAt !== null && previousContentAt !== null && contentAt !== previousContentAt)
        || (contentAt === null && ((previousRefreshing && !refreshing)
          || (scannedAt !== null && previousScannedAt !== null && scannedAt !== previousScannedAt)))
      if (changed || revision !== checked || !snapshot.lastCheckedAt) invalidateSectionPathIndex(sectionKey)
      if (changed) snapshot.libraryChangedAt = new Date().toISOString()
      else if (!snapshot.libraryChangedAt && contentAt !== null) snapshot.libraryChangedAt = new Date(contentAt * 1000).toISOString()
      previousContentAt = contentAt; previousScannedAt = scannedAt; previousRefreshing = refreshing; mediaHint = false
      const activities = [...(lease?.stream.activities.values() ?? [])].filter(item => item.sectionKey === sectionKey && item.active)
      const latest = activities.at(-1)
      snapshot.scan = latest
        ? { progress: latest.progress, title: latest.title, subtitle: latest.subtitle }
        : refreshing ? { progress: null, title: '正在扫描音乐库', subtitle: '' } : null
      if (changed) publish('plex-library-change')
      snapshot.lastCheckedAt = new Date().toISOString()
      snapshot.error = null

      // A scan can be running when this read started. Defer expensive lookups until idle.
      if (busy() || refreshing) { followUpPending = true; checked = revision; nextPollAt = Date.now() + 15_000; return }
      await initPlexClient(config.plex)
      if (checkPlaylists || changed) {
        const sourceIds = new Set<string>()
        for (const source of listSources().filter(item => item.enabled && item.plexPlaylistRatingKey)) {
          activeSignal.throwIfAborted()
          if (busy()) { followUpPending = true; checked = revision; nextPollAt = Date.now() + 15_000; return }
          sourceIds.add(source.id)
          const playlist = await getPlaylistSnapshotByRatingKey(source.plexPlaylistRatingKey, 99999)
          const baseline = source.lastAppliedPlexFingerprint ?? source.lastObservedPlexFingerprint
          const drifted = !playlist || (baseline !== null && buildPlexPlaylistFingerprint(playlist.tracks) !== baseline)
          const previous = notices.get(source.id)
          if (drifted) notices.set(source.id, playlist
            ? { kind: 'changed', message: config.sync.reconcileOnPlexDrift !== false
                ? 'Plex 歌单的曲目或顺序已在外部修改，下次正常同步将按当前设置核对。'
                : 'Plex 歌单的曲目或顺序已在外部修改；自动核对外部变化已关闭，可手动检查同步。' }
            : { kind: 'missing', message: 'Plex 目标歌单已被删除，请检查目标设置后同步。' })
          else notices.delete(source.id)
          if (previous?.kind !== notices.get(source.id)?.kind) publish('plex-library-change')
        }
        for (const id of notices.keys()) if (!sourceIds.has(id)) notices.delete(id)
        lastPlaylistPollAt = Date.now()
        followUpPending = false
      }
      if (config.sync.enabled && !busy()) {
        const ready = await findIndexedRecoverySources(config, sectionKey, activeSignal)
        if (busy()) { requested++; return }
        let queued = false
        for (const [id, signature] of ready) {
          if (notices.has(id) || attemptedRecovery.get(id) === signature) continue
          if (enqueueIndexedRecovery(id, getConfig())) {
            attemptedRecovery.set(id, signature)
            queued = true
          }
        }
        for (const id of attemptedRecovery.keys()) if (!ready.has(id)) attemptedRecovery.delete(id)
        if (queued) { publish('plex-library-change'); wakeWorker() }
      }
      activeSignal.throwIfAborted()
      if (activeGeneration !== generation) return
      checked = revision
      snapshot.lastCheckedAt = new Date().toISOString()
      snapshot.error = null
      publish('plex-scan-progress')
    })
  }

  function tick() {
    if (stopped) return
    update()
    if (!lease || checking || (requested === checked && Date.now() < nextPollAt)) return
    const signal = controller.signal
    checking = check().catch(() => {
      if (signal.aborted || stopped) return
      checked = requested
      snapshot.error = '暂时无法核对 Plex，稍后自动重试'
      publish('plex-scan-progress')
    }).finally(() => { checking = null })
  }

  const timer = setInterval(tick, 5000)
  timer.unref()
  const handle = {
    update() { update(); attemptedRecovery.clear(); requested++; tick() },
    getSnapshot(): PlexLibraryMonitorSnapshot {
      return { ...snapshot, connected: lease?.stream.connected ?? false, scan: snapshot.scan ? { ...snapshot.scan } : null }
    },
    getSourceNotice(sourceId: string) { return notices.get(sourceId) ?? null },
    async stop() {
      stopped = true; controller.abort(); clearInterval(timer); release()
      await checking
      await Promise.allSettled([...closing])
      if (current === handle) current = null
    },
  }
  current = handle
  update(); tick()
  return handle
}

interface LibrarySection {
  key: string | number
  title: string
  type: string
  refreshing?: boolean | number | string
  scannedAt?: number | string
  contentChangedAt?: number | string
}
function timestamp(value: number | string | undefined): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 && parsed < 100_000_000_000 ? parsed : null
}
