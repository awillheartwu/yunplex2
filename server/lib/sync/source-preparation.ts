import { readConfigFromDb } from '../db'
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
import { getSourceFailurePolicy, shouldDeferFailure, type SourceFailurePolicy } from './failure-policy'
import { confirmSongDetailsAvailable } from '../tasks/completion'

export interface SourceSongSnapshot {
  songs: NeteaseSong[]
  songIndices: number[]
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
    const songs = await fetchAlbumSongs(input.playlistId, input.cookie)
    if (!input.dryRun) confirmSongDetailsAvailable(input.source.id, new Map(songs.map(song => [song.id, song])))
    return {
      songs,
      songIndices: songs.map((_, index) => index),
      trackUpdateTime: null,
      trackIds: [],
      allTrackIds: [],
      playlistName: input.source.neteasePlaylistName,
    }
  }

  const summary = await fetchPlaylistSummary(input.playlistId, input.limit, input.cookie)
  const requestedIds = summary.trackIds.map(track => track.id)
  const cachedRaw = loadNeteaseRawSongs(requestedIds)
  const failures = getSourceFailurePolicy(input.source.id).failuresBySongId
  const maxFailureAttempts = readConfigFromDb().sync.maxFailureAttempts
  const missingIds = [...new Set(requestedIds.filter(id => !cachedRaw.has(id)
    && !shouldDeferFailure(failures[id], maxFailureAttempts)))]
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
  if (!input.dryRun) confirmSongDetailsAvailable(input.source.id, songsById)
  const uniqueRequested = [...new Set(requestedIds)]
  const cachedCount = uniqueRequested.filter(id => cachedRaw.has(id)).length
  return {
    songs: summary.trackIds.flatMap(track => {
      const song = songsById.get(track.id)
      return song ? [song] : []
    }),
    songIndices: summary.trackIds.flatMap((track, index) => songsById.has(track.id) ? [index] : []),
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
  const failures = [...Object.values(failurePolicy.failuresBySongId), ...Object.values(failurePolicy.removalFailures)]
  return {
    unresolvedMissingDetailIds: missingSongDetailIds.filter(songId =>
      !shouldDeferFailure(failurePolicy.failuresBySongId[songId], maxFailureAttempts),
    ),
    hasActionableFailures: failures
      .some(entry => !shouldDeferFailure(entry, maxFailureAttempts)),
    unresolvedPartialState: source.lastStatus !== 'success'
      && failures.length === 0,
  }
}

export function addMissingDetailSongs(
  job: RunBuilder,
  sourceId: string,
  missingSongDetailIds: readonly number[],
  failurePolicy: SourceFailurePolicy,
  sourceSongIds: readonly number[],
): void {
  const maxFailureAttempts = readConfigFromDb().sync.maxFailureAttempts
  const missingIds = new Set(missingSongDetailIds)
  for (const [neteaseIndex, missingSongId] of sourceSongIds.entries()) {
    if (!missingIds.has(missingSongId)) continue
    const [taskSongId] = job.addSongs(sourceId, [{
      songName: `网易云歌曲 #${missingSongId}`,
      artist: '详情未返回',
      album: '未知专辑',
      status: failurePolicy.failuresBySongId[missingSongId]?.status === 'ignored' ? 'ignored_failure'
        : shouldDeferFailure(failurePolicy.failuresBySongId[missingSongId], maxFailureAttempts) ? 'awaiting_retry' : 'failed_download',
      neteaseSongId: missingSongId,
      neteaseIndex,
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
