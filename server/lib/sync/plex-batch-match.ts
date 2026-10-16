import type { AppConfig } from '../config/types'
import type { NeteaseSong } from '../netease'
import { findTracksByFilePath, getRecentlyAddedTracks, getLibraryScanState, invalidateSectionPathIndex, type PlexScanRequest, type PlexTrack } from '../plex-client'
import { mapLocalPathToPlex, normalizeExistingLocalPath, resolveAccessibleLocalPath } from './path-map'
import type { PlexMatchAttemptTrace, PlexMatchResult, PlexMatchStrategy } from './plex-match'
import type { PlexScanEvents } from '../plex-scan-events'

export interface PlexBatchMatchRequest {
  key: string
  song: NeteaseSong
  filePath: string | null | undefined
}

export interface PlexBatchMatchOptions {
  throwIfCancelled?: () => void
  scanRequest?: PlexScanRequest
  scanEvents?: PlexScanEvents
}

/** Bounded exact-path lookups per round; the Plex section path index itself is shared and TTL-cached. */
export const PLEX_BATCH_PATH_LOOKUP_CONCURRENCY = 3
const RECENT_TRACK_LOOKUP_LIMIT = 100
/** Cancellation is noticed at most this often while the batch waits between rounds. */
const CANCELLATION_POLL_INTERVAL_MS = 250
const MAX_SCAN_WAIT_MS = 10 * 60_000

interface BatchEntry {
  key: string
  normalizedPath: string | null
  expectedPlexPath: string | null
  traces: PlexMatchAttemptTrace[]
  result: PlexMatchResult | null
}

/**
 * Match a batch of expected local files against Plex by exact path only.
 *
 * Unresolved paths share retry rounds. A requested scan can extend the ordinary
 * window while it is active; once idle, the configured window allows indexing
 * to settle. Waiting remains bounded and the final lookup bypasses the TTL cache.
 */
export async function matchTracksInPlexWithRetry(
  sectionKey: string,
  requests: readonly PlexBatchMatchRequest[],
  cfg: AppConfig,
  maxRetries = 5,
  delayMs = 15000,
  options: PlexBatchMatchOptions = {},
): Promise<Map<string, PlexMatchResult>> {
  const throwIfCancelled = options.throwIfCancelled
  const entries: BatchEntry[] = requests.map(request => {
    const normalizedPath = normalizeExistingLocalPath(request.filePath)
    return {
      key: request.key,
      normalizedPath,
      expectedPlexPath: normalizedPath ? mapLocalPathToPlex(normalizedPath, cfg) : null,
      traces: [],
      result: null,
    }
  })

  // Without a concrete local file there is nothing to retry by path. Mirror the
  // single-request helper's terminal shape without scheduling any round delay.
  for (const entry of entries) {
    if (entry.normalizedPath) continue
    entry.result = {
      ratingKey: null,
      matchedBy: null,
      attempts: maxRetries + 1,
      localFilePath: null,
      traces: Array.from({ length: maxRetries + 1 }, (_unused, attempt) => emptyTrace(attempt, 0)),
    }
  }

  let pending = entries.filter(entry => entry.normalizedPath !== null)
  const started = Date.now()
  const settleWindowMs = Math.max(1, maxRetries) * delayMs
  const scanDeadline = started + Math.max(MAX_SCAN_WAIT_MS, settleWindowMs)
  let idleDeadline = started + settleWindowMs
  let wasScanning = false
  let scanCompleted = false
  let scanActive = false
  let finalLookup = false
  let round = 0
  let lastEventEnd = 0

  while (pending.length > 0) {
    throwIfCancelled?.()
    const events = options.scanEvents?.getState()
    if (options.scanRequest) {
      const scan = await getLibraryScanState(sectionKey, options.scanRequest.activityId)
      scanActive = scan.active || Boolean(events?.active)
      if (scanActive) idleDeadline = Date.now() + settleWindowMs
      const advanced = options.scanRequest.previousScanAt !== null && scan.scannedAt !== null && scan.scannedAt > options.scanRequest.previousScanAt
      const finished = !scanActive && (wasScanning || ((advanced || events?.completed) && !scanCompleted))
      if (finished) {
        scanCompleted = true
        idleDeadline = Date.now() + settleWindowMs
        invalidateSectionPathIndex(sectionKey)
      }
      if (finalLookup) invalidateSectionPathIndex(sectionKey)
      wasScanning = scanActive
    }
    if (events && events.endRevision > lastEventEnd) {
      invalidateSectionPathIndex(sectionKey)
      lastEventEnd = events.endRevision
    }

    const exactCandidates = await mapWithConcurrency(
      pending,
      PLEX_BATCH_PATH_LOOKUP_CONCURRENCY,
      async (entry) => {
        throwIfCancelled?.()
        if (!entry.expectedPlexPath) return []
        const tracks = await findTracksByFilePath(sectionKey, entry.expectedPlexPath)
        return uniqueTracks(tracks.filter(track => trackMapsToLocalPath(track, entry.normalizedPath!, cfg)))
      },
    )

    throwIfCancelled?.()

    const resolvedThisRound = new Set<BatchEntry>()
    const missed: Array<{ entry: BatchEntry; exact: PlexTrack[] }> = []
    pending.forEach((entry, index) => {
      const exact = exactCandidates[index] ?? []
      if (exact.length === 1) {
        entry.traces.push({ ...emptyTrace(round, 1), matchedBy: 'path_lookup' })
        entry.result = found(exact[0]!, 'path_lookup', round, entry.normalizedPath!, entry.traces)
        resolvedThisRound.add(entry)
        return
      }
      missed.push({ entry, exact })
    })

    if (missed.length > 0) {
      // One recently-added read per round: Plex can expose a newly scanned item
      // before its path index is refreshed. Matching still compares Media.Part.file
      // exactly, and ambiguity never binds.
      const recentTracks = await getRecentlyAddedTracks(sectionKey, RECENT_TRACK_LOOKUP_LIMIT)
      throwIfCancelled?.()
      for (const { entry, exact } of missed) {
        const recentCandidates = uniqueTracks(
          recentTracks.filter(track => trackMapsToLocalPath(track, entry.normalizedPath!, cfg)),
        )
        const candidates = uniqueTracks([...exact, ...recentCandidates])
        if (candidates.length === 1) {
          entry.traces.push({ ...emptyTrace(round, 1), matchedBy: 'recent_path_lookup' })
          entry.result = found(candidates[0]!, 'recent_path_lookup', round, entry.normalizedPath!, entry.traces)
          resolvedThisRound.add(entry)
          continue
        }
        entry.traces.push(emptyTrace(round, candidates.length))
      }
    }

    pending = pending.filter(entry => !resolvedThisRound.has(entry))
    if (options.scanRequest && resolvedThisRound.size > 0) idleDeadline = Date.now() + settleWindowMs

    if (pending.length === 0) break
    if (finalLookup) {
      if (Date.now() >= scanDeadline || (!scanActive && scanCompleted && resolvedThisRound.size === 0)) break
      finalLookup = false
    }
    if (!options.scanRequest && round >= maxRetries) break
    // An initially idle section is not proof that the requested scan has run.
    const deadline = options.scanRequest ? Math.min(scanDeadline, scanActive || !scanCompleted ? scanDeadline : idleDeadline) : Infinity
    if (Date.now() >= deadline) finalLookup = true
    else {
      const waitMs = Math.min(delayMs, deadline - Date.now())
      if (events?.connected) await options.scanEvents!.waitForChange(events.revision, waitMs)
      else await cancellableDelay(waitMs, throwIfCancelled)
    }
    if (options.scanRequest && Date.now() >= deadline) finalLookup = true
    round++
  }

  const results = new Map<string, PlexMatchResult>()
  for (const entry of entries) {
    results.set(entry.key, entry.result ?? {
      ratingKey: null,
      matchedBy: null,
      attempts: entry.traces.length,
      localFilePath: entry.normalizedPath,
      traces: entry.traces,
      ...(options.scanRequest ? { scan: { active: scanActive, completed: scanCompleted, timedOut: (!scanCompleted || scanActive) && Date.now() >= scanDeadline, waitedMs: Date.now() - started } } : {}),
    })
  }
  return results
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workerCount = Math.min(Math.max(limit, 1), items.length)
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await fn(items[index]!)
    }
  })
  await Promise.all(workers)
  return results
}

async function cancellableDelay(delayMs: number, throwIfCancelled?: () => void): Promise<void> {
  let remaining = Math.max(0, delayMs)
  while (remaining > 0) {
    const slice = Math.min(CANCELLATION_POLL_INTERVAL_MS, remaining)
    await new Promise<void>(resolve => setTimeout(resolve, slice))
    remaining -= slice
    throwIfCancelled?.()
  }
}

function emptyTrace(attempt: number, pathCandidates: number): PlexMatchAttemptTrace {
  return { attempt, artistCandidates: 0, titleCandidates: 0, pathCandidates, matchedBy: null }
}

function found(
  track: PlexTrack,
  matchedBy: PlexMatchStrategy,
  attempt: number,
  localFilePath: string,
  traces: PlexMatchAttemptTrace[],
): PlexMatchResult {
  return { ratingKey: track.ratingKey, matchedBy, attempts: attempt + 1, localFilePath, traces }
}

function uniqueTracks(tracks: readonly PlexTrack[]): PlexTrack[] {
  const seen = new Set<string>()
  return tracks.filter(track => {
    if (seen.has(track.ratingKey)) return false
    seen.add(track.ratingKey)
    return true
  })
}

function trackMapsToLocalPath(track: PlexTrack, expectedLocalPath: string, cfg: AppConfig): boolean {
  return (track.Media ?? []).some(media => (media.Part ?? []).some(part => {
    const resolvedPath = resolveAccessibleLocalPath(part.file, cfg)
    return resolvedPath !== null && normalizeExistingLocalPath(resolvedPath) === expectedLocalPath
  }))
}
