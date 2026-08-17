import type { AppConfig } from '../config/types'
import type { NeteaseSong } from '../netease'
import {
  getRecentlyAddedTracks,
  searchTrack,
  searchTracksByArtists,
  searchTracksByAlbum,
  searchTracksByTitle,
  findTracksByFilePath,
  type PlexTrack,
} from '../plex-client'
import {
  mapLocalPathToPlex,
  normalizeExistingLocalPath,
  resolveAccessibleLocalPath,
} from './path-map'
import { resolveSongArtistCandidateNames } from './song-artist-candidates'

export type PlexMatchStrategy = 'direct_search' | 'path_lookup' | 'album_path_lookup' | 'recent_path_lookup'
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
  options: { pathOnly?: boolean } = {},
): Promise<PlexMatchResult> {
  const normalizedExpectedPath = normalizeExistingLocalPath(expectedLocalPath)
  if (options.pathOnly) {
    return matchTrackByExactPathWithRetry(
      sectionKey,
      cfg,
      normalizedExpectedPath,
      maxRetries,
      delayMs,
    )
  }
  const candidates = await resolveSongArtistCandidateNames(song.artists)
  const traces: PlexMatchAttemptTrace[] = []

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }

    if (normalizedExpectedPath) {
      const expectedPlexPath = mapLocalPathToPlex(normalizedExpectedPath, cfg)
      if (expectedPlexPath) {
        const exactPathMatches = await findTracksByFilePath(sectionKey, expectedPlexPath)
        const exactPathMatch = exactPathMatches.find(track => trackMapsToLocalPath(track, normalizedExpectedPath, cfg))
        if (exactPathMatch) {
          traces.push({
            attempt,
            artistCandidates: candidates.length,
            titleCandidates: 0,
            pathCandidates: exactPathMatches.length,
            matchedBy: 'path_lookup',
          })
          return {
            ratingKey: exactPathMatch.ratingKey,
            matchedBy: 'path_lookup',
            attempts: attempt + 1,
            localFilePath: normalizedExpectedPath,
            traces,
          }
        }
      }

      // A concrete local file is an identity claim: only the Plex item whose
      // media path maps back to that exact file may satisfy it. Metadata-only
      // matches frequently point at an older copy and must never outrank the
      // newly indexed file.
      const [direct, titleMatches, artistMatches, albumMatches] = await Promise.all([
        searchTrack(sectionKey, song.name, candidates, song.album.name),
        searchTracksByTitle(sectionKey, song.name),
        searchTracksByArtists(sectionKey, candidates),
        searchTracksByAlbum(sectionKey, song.album.name),
      ])
      const seen = new Set<string>()
      const pathCandidates = [
        ...(direct ? [direct] : []),
        ...titleMatches,
        ...artistMatches,
      ].filter((track) => {
        if (seen.has(track.ratingKey)) return false
        seen.add(track.ratingKey)
        return true
      })
      const albumPathCandidates = albumMatches.filter((track) => {
        if (seen.has(track.ratingKey)) return false
        seen.add(track.ratingKey)
        return true
      })
      const pathMatch = pathCandidates.find(track => trackMapsToLocalPath(track, normalizedExpectedPath, cfg))
      const albumPathMatch = albumPathCandidates.find(track => trackMapsToLocalPath(track, normalizedExpectedPath, cfg))

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
      if (albumPathMatch) {
        traces.push({
          attempt,
          artistCandidates: candidates.length,
          titleCandidates: titleMatches.length,
          pathCandidates: pathCandidates.length + albumPathCandidates.length,
          matchedBy: 'album_path_lookup',
        })
        return {
          ratingKey: albumPathMatch.ratingKey,
          matchedBy: 'album_path_lookup',
          attempts: attempt + 1,
          localFilePath: normalizedExpectedPath,
          traces,
        }
      }

      const recentTracks = await getRecentlyAddedTracks(sectionKey, 100)
      const recentPathMatch = recentTracks.find(track => trackMapsToLocalPath(track, normalizedExpectedPath, cfg))

      if (recentPathMatch) {
        traces.push({
          attempt,
          artistCandidates: candidates.length,
          titleCandidates: titleMatches.length,
          pathCandidates: pathCandidates.length + albumPathCandidates.length + recentTracks.length,
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
        pathCandidates: pathCandidates.length + albumPathCandidates.length + recentTracks.length,
        matchedBy: null,
      })
      continue
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
        localFilePath: null,
        traces,
      }
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

async function matchTrackByExactPathWithRetry(
  sectionKey: string,
  cfg: AppConfig,
  normalizedExpectedPath: string | null,
  maxRetries: number,
  delayMs: number,
): Promise<PlexMatchResult> {
  const traces: PlexMatchAttemptTrace[] = []
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await new Promise(resolve => setTimeout(resolve, delayMs))
    if (!normalizedExpectedPath) {
      traces.push({ attempt, artistCandidates: 0, titleCandidates: 0, pathCandidates: 0, matchedBy: null })
      continue
    }

    const expectedPlexPath = mapLocalPathToPlex(normalizedExpectedPath, cfg)
    const exactMatches = expectedPlexPath
      ? await findTracksByFilePath(sectionKey, expectedPlexPath)
      : []
    const exactCandidates = uniqueTracks(exactMatches
      .filter(track => trackMapsToLocalPath(track, normalizedExpectedPath, cfg)))
    const exact = exactCandidates.length === 1 ? exactCandidates[0] : null
    if (exact) {
      traces.push({
        attempt,
        artistCandidates: 0,
        titleCandidates: 0,
        pathCandidates: exactCandidates.length,
        matchedBy: 'path_lookup',
      })
      return {
        ratingKey: exact.ratingKey,
        matchedBy: 'path_lookup',
        attempts: attempt + 1,
        localFilePath: normalizedExpectedPath,
        traces,
      }
    }

    const recentTracks = await getRecentlyAddedTracks(sectionKey, 100)
    const recentCandidates = uniqueTracks(recentTracks
      .filter(track => trackMapsToLocalPath(track, normalizedExpectedPath, cfg)))
    const combinedCandidates = uniqueTracks([...exactCandidates, ...recentCandidates])
    const recent = combinedCandidates.length === 1 ? combinedCandidates[0] : null
    const pathCandidates = combinedCandidates.length
    if (recent) {
      traces.push({
        attempt,
        artistCandidates: 0,
        titleCandidates: 0,
        pathCandidates,
        matchedBy: 'recent_path_lookup',
      })
      return {
        ratingKey: recent.ratingKey,
        matchedBy: 'recent_path_lookup',
        attempts: attempt + 1,
        localFilePath: normalizedExpectedPath,
        traces,
      }
    }
    traces.push({ attempt, artistCandidates: 0, titleCandidates: 0, pathCandidates, matchedBy: null })
  }
  return {
    ratingKey: null,
    matchedBy: null,
    attempts: maxRetries + 1,
    localFilePath: normalizedExpectedPath,
    traces,
  }
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

export function inferPlexMatchFailureCause(
  result: PlexMatchResult,
  _context: {
    downloadedSongs: number
    failedDownloadedSongs: number
  },
): PlexMatchFailureCause {
  if (result.ratingKey) return 'unknown'
  // Once a concrete local media identity exists, failure means Plex never
  // exposed that exact mapped path. Metadata candidates are intentionally not
  // accepted as substitutes, so the actionable problem is visibility/indexing
  // or path publication rather than title similarity.
  if (result.localFilePath) return 'library_visibility'
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
