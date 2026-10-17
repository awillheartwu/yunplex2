import type { PlaylistSource } from '../playlist/types'
import type { RunBuilder } from '../run/builder'
import {
  fetchAlbumSongs,
  fetchNeteaseSongDetails,
  fetchPlaylistSummary,
  mapRawSong,
  type NeteaseSong,
} from '../netease'
import { loadNeteaseRawSongs, saveNeteaseRawSongs } from '../netease-song-cache'
import {
  isTerminalFailure,
  shouldPauseSourceFailure,
  type SourceFailurePolicy,
} from '../tasks/failure-records'
import type { TrackResolution } from './types'

export interface SourceSongSnapshot {
  songs: NeteaseSong[]
  trackUpdateTime: number | null
  trackIds: { id: number }[]
  allTrackIds: { id: number }[]
  playlistName: string | null
  detailSummary?: string
}

export async function loadSourceSongSnapshot(input: {
  source: PlaylistSource
  playlistId: number
  limit: number | undefined
  cookie: string
  dryRun: boolean
}): Promise<SourceSongSnapshot> {
  if (input.source.type === 'album') {
    return {
      songs: await fetchAlbumSongs(input.playlistId, input.cookie),
      trackUpdateTime: null,
      trackIds: [],
      allTrackIds: [],
      playlistName: input.source.neteasePlaylistName,
    }
  }

  const summary = await fetchPlaylistSummary(input.playlistId, input.limit, input.cookie)
  const requestedIds = summary.trackIds.map(track => track.id)
  const cachedRaw = loadNeteaseRawSongs(requestedIds)
  const missingIds = [...new Set(requestedIds.filter(id => !cachedRaw.has(id)))]
  const fetched = missingIds.length > 0
    ? await fetchNeteaseSongDetails(missingIds, input.cookie)
    : { songs: [], rawSongs: [] }
  if (!input.dryRun && fetched.rawSongs.length > 0) saveNeteaseRawSongs(fetched.rawSongs)

  const rawById = new Map(cachedRaw)
  for (const raw of fetched.rawSongs) rawById.set(raw.id, raw)
  const songsById = new Map<number, NeteaseSong>(fetched.songs.map(song => [song.id, song]))
  for (const [id, raw] of rawById) {
    if (!songsById.has(id)) songsById.set(id, mapRawSong(raw))
  }
  const uniqueRequested = [...new Set(requestedIds)]
  const cachedCount = uniqueRequested.filter(id => cachedRaw.has(id)).length
  return {
    songs: summary.trackIds.flatMap(track => {
      const song = songsById.get(track.id)
      return song ? [song] : []
    }),
    trackUpdateTime: summary.trackUpdateTime,
    trackIds: summary.trackIds,
    allTrackIds: summary.allTrackIds,
    playlistName: summary.playlistName,
    detailSummary: `，详情复用 ${cachedCount} 首，补取 ${fetched.rawSongs.length} 首`,
  }
}

export interface SourceSkipState {
  unresolvedMissingDetailIds: number[]
  hasActionableFailures: boolean
  unresolvedPartialState: boolean
}

export function resolveSourceSkipState(input: {
  source: PlaylistSource
  missingSongDetailIds: readonly number[]
  failurePolicy: SourceFailurePolicy
  maxFailureAttempts: number
}): SourceSkipState {
  const { source, missingSongDetailIds, failurePolicy, maxFailureAttempts } = input
  return {
    unresolvedMissingDetailIds: missingSongDetailIds.filter(songId =>
      !isTerminalFailure(failurePolicy.failuresBySongId[songId], maxFailureAttempts),
    ),
    hasActionableFailures: Object.values(failurePolicy.failuresBySongId)
      .some(entry => !isTerminalFailure(entry, maxFailureAttempts)),
    unresolvedPartialState: source.lastStatus !== 'success'
      && Object.keys(failurePolicy.failuresBySongId).length === 0,
  }
}

/** Plex matches the user ignored or the retry policy already paused. */
export function resolveIgnoredPlexMatchSongIds(
  failurePolicy: SourceFailurePolicy,
): Set<number> {
  const result = new Set<number>()
  for (const [songId, entry] of Object.entries(failurePolicy.failuresBySongId)) {
    if (entry.failureKind === 'failed_plex_match'
      && (entry.status === 'ignored' || entry.status === 'paused')) {
      result.add(Number(songId))
    }
  }
  return result
}

/** Apply known failures only after Plex and local media have been checked. */
export function applySourceFailureMemory(input: {
  resolutions: TrackResolution[]
  failurePolicy: SourceFailurePolicy
  maxFailures: number
  retrySourceFailures: boolean
  redownloadAll: boolean
}): void {
  const restricted = new Set(input.failurePolicy.copyrightSongIds)
  for (const resolution of input.resolutions) {
    if (resolution.plexRatingKey || !['needs_download', 'unavailable'].includes(resolution.resolution)) continue
    if (input.redownloadAll || input.retrySourceFailures) continue
    if (restricted.has(resolution.song.id)) {
      resolution.resolution = 'copyright_restricted'
      continue
    }
    if (shouldPauseSourceFailure(
      input.failurePolicy.failuresBySongId[resolution.song.id],
      input.maxFailures,
    )) {
      resolution.resolution = 'ignored_failure'
    }
  }
}

export function addMissingDetailSongs(
  job: RunBuilder,
  sourceId: string,
  missingSongDetailIds: readonly number[],
): void {
  for (const missingSongId of missingSongDetailIds) {
    const [taskSongId] = job.addSongs(sourceId, [{
      songName: `网易云歌曲 #${missingSongId}`,
      artist: '详情未返回',
      album: '未知专辑',
      status: 'failed_download',
      neteaseSongId: missingSongId,
    }])
    if (!taskSongId) continue
    job.updateSong(taskSongId, {
      phase: 'download',
      error: {
        title: '网易云未返回歌曲详情',
        message: '无法获取目标歌曲信息，本轮保持 Plex 歌单不变',
        stage: 'download',
        code: 'source_missing',
        songName: `网易云歌曲 #${missingSongId}`,
      },
      metadata: {
        matchTrace: {
          source: 'download_required',
          decision: 'preserved',
          deletionProtectionReason: '网易云 song_detail 未返回该 trackId，本轮目标不完整',
        },
      },
    })
  }
}
