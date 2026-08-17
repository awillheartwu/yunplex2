import type { AppConfig } from '../config/types'
import type { NeteaseSong } from '../netease'
import { findTracksByFilePath, getRecentlyAddedTracks, type PlexTrack } from '../plex-client'
import { mapLocalPathToPlex, normalizeExistingLocalPath, resolveAccessibleLocalPath } from './path-map'

export type PlexMatchStrategy = 'path_lookup' | 'recent_path_lookup'
export type PlexMatchFailureCause = 'library_visibility' | 'unknown'

export interface PlexMatchAttemptTrace {
  attempt: number
  artistCandidates: 0
  titleCandidates: 0
  pathCandidates: number
  matchedBy: PlexMatchStrategy | null
}

export interface PlexMatchResult {
  ratingKey: string | null
  matchedBy: PlexMatchStrategy | null
  attempts: number
  localFilePath: string | null
  traces: PlexMatchAttemptTrace[]
}

/** Plex scraper metadata is presentation only; retry exclusively by exact file path. */
export async function matchTrackInPlexWithRetry(
  sectionKey: string,
  _song: NeteaseSong,
  cfg: AppConfig,
  expectedLocalPath: string | null | undefined,
  maxRetries = 5,
  delayMs = 15000,
  _options: { pathOnly?: boolean } = {},
): Promise<PlexMatchResult> {
  const normalizedExpectedPath = normalizeExistingLocalPath(expectedLocalPath)
  const traces: PlexMatchAttemptTrace[] = []

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await new Promise(resolve => setTimeout(resolve, delayMs))
    if (!normalizedExpectedPath) {
      traces.push(emptyTrace(attempt, 0))
      continue
    }

    const expectedPlexPath = mapLocalPathToPlex(normalizedExpectedPath, cfg)
    const exactCandidates = expectedPlexPath
      ? uniqueTracks((await findTracksByFilePath(sectionKey, expectedPlexPath))
          .filter(track => trackMapsToLocalPath(track, normalizedExpectedPath, cfg)))
      : []
    if (exactCandidates.length === 1) {
      traces.push({ ...emptyTrace(attempt, 1), matchedBy: 'path_lookup' })
      return found(exactCandidates[0]!, 'path_lookup', attempt, normalizedExpectedPath, traces)
    }

    // Plex can expose a newly scanned item before its path index is refreshed.
    // The fallback still compares Media.Part.file exactly and never metadata.
    const recentCandidates = uniqueTracks((await getRecentlyAddedTracks(sectionKey, 100))
      .filter(track => trackMapsToLocalPath(track, normalizedExpectedPath, cfg)))
    const candidates = uniqueTracks([...exactCandidates, ...recentCandidates])
    if (candidates.length === 1) {
      traces.push({ ...emptyTrace(attempt, 1), matchedBy: 'recent_path_lookup' })
      return found(candidates[0]!, 'recent_path_lookup', attempt, normalizedExpectedPath, traces)
    }
    traces.push(emptyTrace(attempt, candidates.length))
  }

  return {
    ratingKey: null,
    matchedBy: null,
    attempts: maxRetries + 1,
    localFilePath: normalizedExpectedPath,
    traces,
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

export function inferPlexMatchFailureCause(result: PlexMatchResult): PlexMatchFailureCause {
  return !result.ratingKey && result.localFilePath ? 'library_visibility' : 'unknown'
}

export function describePlexMatchFailure(cause: PlexMatchFailureCause, cfg: AppConfig): string {
  if (cause === 'library_visibility') {
    return `Plex 没有看到托管文件的精确路径。当前下载目录是 ${cfg.download.dir}，Plex 媒体库路径前缀为 ${cfg.download.plexLibraryPathPrefix || '(未配置)'}。请确认共享目录与路径映射。`
  }
  return 'Plex 在重试窗口内没有返回托管文件的精确路径，请检查媒体库扫描与路径映射。'
}
