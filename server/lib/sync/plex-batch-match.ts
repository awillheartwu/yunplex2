import type { AppConfig } from '../config/types'
import type { NeteaseSong } from '../netease'
import { findTracksByFilePath, getRecentlyAddedTracks, type PlexTrack } from '../plex-client'
import { mapLocalPathToPlex, normalizeExistingLocalPath, resolveAccessibleLocalPath } from './path-map'
import type { PlexMatchAttemptTrace, PlexMatchResult, PlexMatchStrategy } from './plex-match'

export interface PlexBatchMatchRequest {
  key: string
  song: NeteaseSong
  filePath: string | null | undefined
}

export interface PlexBatchMatchOptions {
  throwIfCancelled?: () => void
}

/** Bounded exact-path lookups per round; the Plex section path index itself is shared and TTL-cached. */
export const PLEX_BATCH_PATH_LOOKUP_CONCURRENCY = 3
const RECENT_TRACK_LOOKUP_LIMIT = 100
/** Cancellation is noticed at most this often while the batch waits between rounds. */
const CANCELLATION_POLL_INTERVAL_MS = 250

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
 * Every unresolved path shares one delayed retry round, so a batch waits at most
 * `maxRetries * delayMs` in total no matter how many songs are missing. Paths that
 * resolved in an earlier round never issue another lookup. The helper reuses the
 * client's TTL-cached Plex section path index and never triggers a scan or refresh.
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

  for (let round = 0; round <= maxRetries && pending.length > 0; round++) {
    throwIfCancelled?.()

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

    if (pending.length > 0 && round < maxRetries) {
      await cancellableDelay(delayMs, throwIfCancelled)
    }
  }

  const results = new Map<string, PlexMatchResult>()
  for (const entry of entries) {
    results.set(entry.key, entry.result ?? {
      ratingKey: null,
      matchedBy: null,
      attempts: entry.traces.length,
      localFilePath: entry.normalizedPath,
      traces: entry.traces,
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
