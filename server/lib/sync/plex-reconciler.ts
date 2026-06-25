import type { AppConfig } from '../config/types'
import type { NeteaseSong } from '../netease'
import type { RunBuilder } from '../run/builder'
import type { PlaylistSource } from '../playlist/types'
import type { TrackResolution } from './types'
import {
  initPlexClient,
  findPlaylist,
  getPlaylistByRatingKey,
  createPlaylist,
  refreshLibrary,
  getSectionKey,
} from '../plex-client'
import { resolveTracks } from './lookup'
import { applyFullReorder } from './reorder'
import { matchTrackInPlexWithRetry, type PlexMatchResult } from './plex-match'

interface PlexPlaylist {
  ratingKey: string
  title: string
}

export interface ReconcileResult {
  resolutions: TrackResolution[]
  extraTracks: Array<{ playlistItemId: number; title: string; artist: string; album: string }>
  plexPlaylist: PlexPlaylist
  sectionKey: string
}

/**
 * Full Plex reconciliation for one playlist source.
 *
 * 1. Find or create the Plex playlist
 * 2. Fetch Plex playlist tracks
 * 3. Resolve every Netease song through the tiered lookup chain:
 *    DB cache → Plex library → disk → download/unavailable
 * 4. Identify extra tracks (in Plex playlist but not Netease)
 */
export async function reconcileSource(
  source: PlaylistSource,
  yunSongs: NeteaseSong[],
  cfg: AppConfig,
  job: RunBuilder,
  splitArtists: (artists: { name: string }[]) => [string, string],
  _cancelRequested: () => boolean,
  _log: (level: string, msg: string) => void,
  skipPlexPlaylist = false,
): Promise<ReconcileResult> {
  await initPlexClient(cfg.plex)

  // Lookup: ratingKey first (stable ID binding), name fallback
  let plexPlaylist = source.plexPlaylistRatingKey
    ? await getPlaylistByRatingKey(source.plexPlaylistRatingKey)
    : null

  if (!plexPlaylist && !skipPlexPlaylist) {
    const plexName = source.plexPlaylistName || source.neteasePlaylistName
    plexPlaylist = await findPlaylist(plexName)

    if (!plexPlaylist) {
      if (source.autoCreatePlexPlaylist) {
        const sectionKey = await getSectionKey(cfg.plex.section)
        if (!sectionKey) throw new Error('未找到 Plex 音乐库分区')
        plexPlaylist = await createPlaylist(plexName, sectionKey)
      } else {
        throw new Error(`Plex 中未找到同名歌单 "${plexName}"，请在 Plex 中创建或开启自动创建`)
      }
    }
  }

  const sectionKey = (await getSectionKey(cfg.plex.section)) ?? ''

  const { resolutions, extraTracks } = await resolveTracks(
    yunSongs,
    skipPlexPlaylist ? '' : plexPlaylist!.ratingKey,
    sectionKey,
    cfg,
  )

  const newCount = resolutions.filter((r) =>
    ['found_in_plex_library', 'found_on_disk', 'needs_download'].includes(r.resolution),
  ).length
  const existingCount = resolutions.filter((r) => r.resolution === 'matched_plex_playlist').length
  const unavailableCount = resolutions.filter((r) => r.resolution === 'unavailable').length

  const isAlbum = source.type === 'album'
  const stepContext = {
    sourceId: source.id,
    sourceName: source.neteasePlaylistName || source.name,
    sourceType: source.type,
    playlistName: source.neteasePlaylistName || source.name,
    plexPlaylistName: plexPlaylist?.title || source.plexPlaylistName || source.neteasePlaylistName || source.name,
    plexPlaylistRatingKey: plexPlaylist?.ratingKey || source.plexPlaylistRatingKey || undefined,
    neteasePlaylistId: source.neteasePlaylistId,
    sectionKey,
  }
  const parts = [`待下载 ${newCount} 首${existingCount > 0 ? `，已存在 ${existingCount} 首` : ''}`]
  if (extraTracks.length > 0) parts.push(`${extraTracks.length} 首待清理`)
  if (unavailableCount > 0) parts.push(`${unavailableCount} 首不可用`)
  job.finishStep(
    job.startStep(
      'compare',
      isAlbum ? (skipPlexPlaylist ? '分析专辑曲目' : '对比 Plex 歌单') : '对比 Plex 歌单',
      { context: stepContext },
    ),
    'success',
    parts.join('，'),
  )

  return {
    resolutions,
    extraTracks,
    plexPlaylist: { ratingKey: plexPlaylist?.ratingKey ?? '', title: plexPlaylist?.title ?? '' },
    sectionKey,
  }
}

/**
 * Refresh Plex library and wait for new tracks to be indexed.
 * Uses probe-based polling: check the first track every 3s, then
 * a per-file cooldown for remaining tracks. Max 60s total.
 */
export async function triggerRescan(sectionKey: string): Promise<void> {
  await refreshLibrary(sectionKey)
}

/**
 * Try to find a track in Plex with retries.
 * Returns the found track or null after all retries exhausted.
 */
export async function findTrackWithRetry(
  sectionKey: string,
  song: NeteaseSong,
  cfg: AppConfig,
  expectedLocalPath: string | null | undefined,
  maxRetries = 5,
  delayMs = 15000,
): Promise<string | null> {
  const result = await findTrackWithRetryDetailed(
    sectionKey,
    song,
    cfg,
    expectedLocalPath,
    maxRetries,
    delayMs,
  )
  return result.ratingKey
}

export async function findTrackWithRetryDetailed(
  sectionKey: string,
  song: NeteaseSong,
  cfg: AppConfig,
  expectedLocalPath: string | null | undefined,
  maxRetries = 5,
  delayMs = 15000,
): Promise<PlexMatchResult> {
  return matchTrackInPlexWithRetry(
    sectionKey,
    song,
    cfg,
    expectedLocalPath,
    maxRetries,
    delayMs,
  )
}

export { applyFullReorder }
