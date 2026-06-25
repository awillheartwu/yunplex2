import type { AppConfig } from '../config/types'
import type { NeteaseSong } from '../netease'
import {
  getRecentlyAddedTracks,
  searchTrack,
  searchTracksByArtists,
  searchTracksByTitle,
} from '../plex-client'
import {
  normalizeExistingLocalPath,
  resolveAccessibleLocalPath,
} from './path-map'
import { resolveSongArtistCandidateNames } from './song-artist-candidates'

export type PlexMatchStrategy = 'direct_search' | 'path_lookup' | 'recent_path_lookup'
export type PlexMatchFailureCause = 'library_visibility' | 'not_indexed_or_metadata_mismatch' | 'unknown'

export interface PlexMatchAttemptTrace {
  attempt: number
  artistCandidates: number
  titleCandidates: number
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

export async function matchTrackInPlexWithRetry(
  sectionKey: string,
  song: NeteaseSong,
  cfg: AppConfig,
  expectedLocalPath: string | null | undefined,
  maxRetries = 5,
  delayMs = 15000,
): Promise<PlexMatchResult> {
  const candidates = await resolveSongArtistCandidateNames(song.artists)
  const normalizedExpectedPath = normalizeExistingLocalPath(expectedLocalPath)
  const traces: PlexMatchAttemptTrace[] = []

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }

    const direct = await searchTrack(sectionKey, song.name, candidates, song.album.name)
    if (direct) {
      traces.push({
        attempt,
        artistCandidates: candidates.length,
        titleCandidates: 0,
        pathCandidates: 0,
        matchedBy: 'direct_search',
      })
      return {
        ratingKey: direct.ratingKey,
        matchedBy: 'direct_search',
        attempts: attempt + 1,
        localFilePath: normalizedExpectedPath,
        traces,
      }
    }

    if (normalizedExpectedPath) {
      const [titleMatches, artistMatches] = await Promise.all([
        searchTracksByTitle(sectionKey, song.name),
        searchTracksByArtists(sectionKey, candidates),
      ])
      const seen = new Set<string>()
      const pathCandidates = [...titleMatches, ...artistMatches].filter((track) => {
        if (seen.has(track.ratingKey)) return false
        seen.add(track.ratingKey)
        return true
      })
      const pathMatch = pathCandidates.find((track) => {
        const candidatePath = track.Media?.[0]?.Part?.[0]?.file
        const resolvedPath = resolveAccessibleLocalPath(candidatePath, cfg)
        return resolvedPath === normalizedExpectedPath
      })

      if (pathMatch) {
        traces.push({
          attempt,
          artistCandidates: candidates.length,
          titleCandidates: titleMatches.length,
          pathCandidates: pathCandidates.length,
          matchedBy: 'path_lookup',
        })
        return {
          ratingKey: pathMatch.ratingKey,
          matchedBy: 'path_lookup',
          attempts: attempt + 1,
          localFilePath: normalizedExpectedPath,
          traces,
        }
      }

      const recentTracks = await getRecentlyAddedTracks(sectionKey, 100)
      const recentPathMatch = recentTracks.find((track) => {
        const candidatePath = track.Media?.[0]?.Part?.[0]?.file
        const resolvedPath = resolveAccessibleLocalPath(candidatePath, cfg)
        return resolvedPath === normalizedExpectedPath
      })

      if (recentPathMatch) {
        traces.push({
          attempt,
          artistCandidates: candidates.length,
          titleCandidates: titleMatches.length,
          pathCandidates: pathCandidates.length + recentTracks.length,
          matchedBy: 'recent_path_lookup',
        })
        return {
          ratingKey: recentPathMatch.ratingKey,
          matchedBy: 'recent_path_lookup',
          attempts: attempt + 1,
          localFilePath: normalizedExpectedPath,
          traces,
        }
      }

      traces.push({
        attempt,
        artistCandidates: candidates.length,
        titleCandidates: titleMatches.length,
        pathCandidates: pathCandidates.length + recentTracks.length,
        matchedBy: null,
      })
      continue
    }

    traces.push({
      attempt,
      artistCandidates: candidates.length,
      titleCandidates: 0,
      pathCandidates: 0,
      matchedBy: null,
    })
  }

  return {
    ratingKey: null,
    matchedBy: null,
    attempts: maxRetries + 1,
    localFilePath: normalizedExpectedPath,
    traces,
  }
}

export function inferPlexMatchFailureCause(
  result: PlexMatchResult,
  context: {
    downloadedSongs: number
    failedDownloadedSongs: number
  },
): PlexMatchFailureCause {
  if (result.ratingKey) return 'unknown'
  if (result.localFilePath && context.downloadedSongs > 0 && context.failedDownloadedSongs === context.downloadedSongs) {
    return 'library_visibility'
  }
  if (result.localFilePath) return 'not_indexed_or_metadata_mismatch'
  return 'unknown'
}

export function describePlexMatchFailure(
  cause: PlexMatchFailureCause,
  cfg: AppConfig,
): string {
  switch (cause) {
    case 'library_visibility':
      return `Plex 没有看到刚下载的新文件。当前下载目录是 ${cfg.download.dir}，而 Plex 媒体库路径前缀配置为 ${cfg.download.plexLibraryPathPrefix || '(未配置)'}。如果应用运行在本机、Plex 运行在另一台机器上，必须把下载目录指向 Plex 实际可见的共享目录，或把应用部署到与 Plex 同一存储环境。`
    case 'not_indexed_or_metadata_mismatch':
      return '文件已下载到本地，但 Plex 在重试窗口内仍未通过标题、艺人或文件路径识别到它。通常是 Plex 扫描延迟、元数据差异，或路径映射配置不一致。'
    default:
      return 'Plex 在重试窗口内未识别到这首歌，请检查媒体库扫描、路径映射和标签匹配。'
  }
}
