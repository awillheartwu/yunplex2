import { randomUUID } from 'node:crypto'
import { buildDownloadTaskIdempotencyKey, enqueueTask, processAll } from './queue'
import { downloadSingleSong, type SingleSongConfig } from './single-song'
import { emitEvent } from '../sync/events'
import {
  fetchPlaylistSongs,
  fetchAlbumSongs,
  fetchSongDetail,
  setArtistAliases,
} from '../netease'
import { createSplitArtists } from '../sync/artist-utils'
import { getQueueStatus } from './queue'
import type { DownloadTask } from './queue'
import { createManualDownloadRun, syncManualDownloadRun } from '../run/store'
import type { MultiArtistFormat } from '../config/types'

export interface DownloadBatchInput {
  type: 'playlist' | 'album' | 'songs'
  neteaseId?: number
  songIds?: number[]
  config: SingleSongConfig & { cookie: string }
}

export interface DownloadBatchResult {
  batchId: string
  total: number
}

/**
 * One-shot download batch: fetch songs from Netease, enqueue, and process.
 * Does NOT create a playlist source or Plex playlist. Fire-and-forget —
 * the caller gets back immediately; progress is tracked via SSE queue-update
 * events and download_tasks history.
 */
export async function runDownloadBatch(input: DownloadBatchInput): Promise<DownloadBatchResult> {
  const batchId = randomUUID()
  const { config } = input

  setArtistAliases(
    (config as unknown as Record<string, unknown>).artistAliases as Record<string, string> ?? {},
    (config as unknown as Record<string, unknown>).applyAliasToAlbum as boolean ?? false,
  )

  // ── 1. Fetch songs from Netease ──
  let songs: Array<{ id: number; name: string; artists?: { name: string }[]; album?: { name: string; id: number } }>

  if (input.type === 'playlist' && input.neteaseId) {
    const result = await fetchPlaylistSongs(input.neteaseId, undefined, config.cookie)
    songs = result.songs.map((s) => ({
      id: s.id,
      name: s.name,
      artists: s.artists,
      album: s.album,
    }))
  } else if (input.type === 'album' && input.neteaseId) {
    const result = await fetchAlbumSongs(input.neteaseId, config.cookie)
    songs = result.map((s) => ({
      id: s.id,
      name: s.name,
      artists: s.artists,
      album: s.album,
    }))
  } else if (input.type === 'songs' && input.songIds?.length) {
    songs = []
    for (const id of input.songIds) {
      try {
        const detail = await fetchSongDetail(id, config.cookie)
        songs.push({ id: detail.id, name: detail.name, artists: detail.artists, album: detail.album })
      } catch {
        // Skip songs that fail to fetch — the user will see the rest
      }
    }
  } else {
    throw new Error('下载类型不支持或缺少必要参数')
  }

  if (songs.length === 0) throw new Error('未找到可下载的歌曲')

  const splitArtists = createSplitArtists(config.multiArtistFormat as MultiArtistFormat)

  const sourceLabel = input.type === 'playlist'
    ? `网易云歌单 ${input.neteaseId || ''}`.trim()
    : input.type === 'album'
      ? `网易云专辑 ${input.neteaseId || ''}`.trim()
      : `${songs.length} 首单曲`
  createManualDownloadRun({
    id: batchId,
    total: songs.length,
    sourceLabel,
    config: { quality: config.quality },
    songs: songs.map(song => ({
      id: `${batchId}:${song.id}`,
      neteaseSongId: song.id,
      songName: song.name,
      artist: song.artists?.map(artist => artist.name).join(' / ') || '',
      album: song.album?.name || '',
      status: 'pending',
      phase: 'download',
    })),
  })

  // ── 2. Enqueue ──
  for (const song of songs) {
    const [albumArtist] = splitArtists(song.artists ?? [])
    enqueueTask({
      sourceId: null,
      songId: song.id,
      songName: song.name,
      artist: albumArtist,
      album: song.album?.name ?? '',
      quality: config.quality,
      jobId: batchId,
      idempotencyKey: buildDownloadTaskIdempotencyKey({
        songId: song.id,
        quality: config.quality,
        downloadDir: config.downloadDir,
        pathFormat: config.pathFormat,
      }),
    })
  }

  // ── 3. Processor ──
  const processor = async (
    task: DownloadTask,
    onProgress: (pct: number, phase?: 'downloading' | 'tagging') => void,
    signal: AbortSignal,
  ) => {
    return downloadSingleSong(task.songId, config, onProgress, signal)
  }

  // ── 4. Fire-and-forget processing ──
  const concurrency = (config as unknown as Record<string, unknown>).downloadConcurrency as number ?? 3
  processAll(processor, batchId, concurrency)
    .then((failed) => {
      syncManualDownloadRun(batchId)
      const status = getQueueStatus()
      emitEvent({
        type: 'queue-update',
        data: {
          type: 'batch-complete',
          batchId,
          batchTotal: songs.length,
          batchFailed: failed,
          batchDone: songs.length - failed,
          ...status,
        },
        timestamp: new Date().toISOString(),
      })
    })
    .catch(() => {
      // processAll already emits failure events per task
      syncManualDownloadRun(batchId)
    })

  // ── 5. Return immediately ──
  return { batchId, total: songs.length }
}
