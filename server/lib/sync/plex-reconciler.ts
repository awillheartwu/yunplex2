import type { AppConfig } from '../config/types'
import type { NeteaseSong } from '../netease'
import type { RunBuilder } from '../run/builder'
import type { PlaylistSource } from '../playlist/types'
import type { TrackResolution } from './types'
import type { ExtraTrack } from './lookup'
import {
  initPlexClient,
  findPlaylist,
  getPlaylistByRatingKey,
  refreshLibrary,
  getSectionKey,
  isWritableAudioPlaylist,
} from '../plex-client'
import { resolveTracks } from './lookup'
import { applyFullReorder } from './reorder'
import { matchTrackInPlexWithRetry, type PlexMatchResult } from './plex-match'
import { pendingPlaylistWrite, playlistServerScope, playlistWriteError } from './playlist-write-state'
import { sourceConvergenceSettingsKey } from './effective-settings'

interface PlexPlaylist {
  ratingKey: string
  title: string
}

export interface ReconcileResult {
  resolutions: TrackResolution[]
  extraTracks: ExtraTrack[]
  plexPlaylist: PlexPlaylist
  sectionKey: string
}

/**
 * Full Plex reconciliation for one playlist source.
 *
 * 1. Find the Plex playlist; creation waits for verified target media
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
  skipPlexPlaylist = false,
  dryRun = false,
  options: { automaticMediaFallback?: boolean; requireExistingPlaylist?: boolean; trustedSongIds?: ReadonlySet<number>; ignoredSongIds?: ReadonlySet<number>; neteaseIndices?: readonly number[] } = {},
): Promise<ReconcileResult> {
  await initPlexClient(cfg.plex)

  const pending = dryRun ? null : pendingPlaylistWrite(source.id)
  if (pending && pending.scope !== playlistServerScope(cfg)) throw playlistWriteError('上次 Plex 写入连接已变化，请明确核对目标后再同步')
  if (pending && pending.kind !== 'create' && pending.playlistKey !== source.plexPlaylistRatingKey) {
    throw playlistWriteError('实际目标与上次未确认写入的歌单不同，请明确核对并重新确认目标')
  }
  if (pending?.kind === 'create' && (!pending.playlistKey
    || (source.plexPlaylistRatingKey !== pending.playlistKey && pending.sourceSettingsKey !== sourceConvergenceSettingsKey(source, cfg)))) {
    throw playlistWriteError('上次创建 Plex 歌单尚未确认，请在收藏设置中明确指定实际目标；不会按同名认领或重发')
  }
  // Lookup only. Creation waits for verified strong media identities.
  const lookupKey = pending?.playlistKey || source.plexPlaylistRatingKey
  let plexPlaylist = lookupKey
    ? await getPlaylistByRatingKey(lookupKey)
    : null
  if (pending && !plexPlaylist) throw playlistWriteError('未确认写入的实际 Plex 歌单不存在或无法读取，请明确选择目标后重试')
  if (plexPlaylist && !isWritableAudioPlaylist(plexPlaylist)) throw playlistWriteError('当前 Plex 目标不是可编辑的普通音乐歌单，请明确选择目标')

  if (!plexPlaylist && !skipPlexPlaylist) {
    if (options.requireExistingPlaylist) throw new Error('Plex 目标歌单已变化，等待正常同步后再恢复索引')
    const plexName = source.plexPlaylistName || source.neteasePlaylistName
    plexPlaylist = await findPlaylist(plexName)

    if (!plexPlaylist) {
      if (source.autoCreatePlexPlaylist) {
        plexPlaylist = { title: plexName, ratingKey: '' }
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
    dryRun,
    { sourceId: source.id, runId: job.getId() },
    options,
  )

  const newCount = resolutions.filter((r) =>
    ['found_in_plex_library', 'found_on_disk', 'needs_download'].includes(r.resolution),
  ).length
  const existingCount = resolutions.filter((r) => r.resolution === 'matched_plex_playlist').length
  const identityConflictCount = resolutions.filter((r) => r.resolution === 'unavailable').length
  const awaitingManualCount = resolutions.filter((r) => r.resolution === 'awaiting_manual').length
  const policyCounts = new Map<string, number>()
  for (const resolution of resolutions) {
    const disposition = resolution.mediaPolicy?.disposition
    if (disposition) policyCounts.set(disposition, (policyCounts.get(disposition) ?? 0) + 1)
  }

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
  if (identityConflictCount > 0) parts.push(`${identityConflictCount} 首媒体身份冲突`)
  if (awaitingManualCount > 0) parts.push(`${awaitingManualCount} 首等待手动选择`)
  const manualExempt = policyCounts.get('manual_exempt') ?? 0
  const reusedManaged = policyCounts.get('reuse_managed') ?? 0
  const plannedDownloads = (policyCounts.get('download_missing') ?? 0)
    + (policyCounts.get('redownload_replaced') ?? 0)
  if (manualExempt > 0) parts.push(`人工豁免 ${manualExempt} 首`)
  if (reusedManaged > 0) parts.push(`复用托管 ${reusedManaged} 首`)
  if (plannedDownloads > 0) parts.push(`${dryRun ? '计划下载' : '策略下载'} ${plannedDownloads} 首`)
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

/** Start one refresh; batch matching monitors the scan and expected file paths. */
export async function triggerRescan(sectionKey: string) {
  return refreshLibrary(sectionKey)
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
  options: { pathOnly?: boolean } = {},
): Promise<PlexMatchResult> {
  return matchTrackInPlexWithRetry(
    sectionKey,
    song,
    cfg,
    expectedLocalPath,
    maxRetries,
    delayMs,
    options,
  )
}

export { applyFullReorder }
