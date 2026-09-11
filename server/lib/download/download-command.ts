import { randomUUID } from 'node:crypto'
import { getDb } from '../db'
import { createManualDownloadRun } from '../run/store'
import { createSplitArtists } from '../sync/artist-utils'
import type { MultiArtistFormat } from '../config/types'
import type { SingleSongConfig } from './single-song'
import type { DownloadResourceSelection, ResourceSelectionFailure } from './resource-selection'
import { buildDownloadTaskIdempotencyKey } from './queue'
import { submitFileTasks } from './file-task-command'

export interface DownloadCommandConfig extends SingleSongConfig {
  artistAliases: Record<string, string>
  applyAliasToAlbum: boolean
}

export interface DownloadCommandResult {
  batchId: string
  total: number
  tasks: Array<{ taskId: string; reused: boolean }>
  selectionFailures: ResourceSelectionFailure[]
}

export function createDownloadCommand(input: {
  selection: DownloadResourceSelection
  sourceContext?: { id: string; name: string }
  config: DownloadCommandConfig
}): DownloadCommandResult {
  if (input.selection.songs.length === 0) {
    const failure = input.selection.failures[0]
    throw new Error(failure
      ? `未找到可下载的歌曲：${failure.songId} ${failure.reason}`
      : '未找到可下载的歌曲')
  }

  const batchId = randomUUID()
  const { config } = input
  const splitArtists = createSplitArtists(config.multiArtistFormat as MultiArtistFormat)
  const sourceLabel = input.sourceContext?.name || input.selection.sourceLabel

  const result = getDb().transaction(() => {
    // The caller owns a run even when every task is idempotently reused from
    // another run. The association table records the actual task IDs later;
    // task ownership itself remains unchanged.
    createManualDownloadRun({
      id: batchId,
      total: input.selection.songs.length,
      sourceLabel,
      sourceIds: input.sourceContext ? [input.sourceContext.id] : undefined,
      config: { quality: config.quality },
      songs: input.selection.songs.map(song => ({
        id: `${batchId}:${song.id}`,
        sourceId: input.sourceContext?.id,
        neteaseSongId: song.id,
        songName: song.name,
        artist: song.artists?.map(artist => artist.name).join(' / ') || '',
        album: song.album?.name || '',
        status: 'pending',
        phase: 'download',
      })),
    })

    const taskSubmission = submitFileTasks(input.selection.songs.map(song => {
      const [albumArtist] = splitArtists(song.artists ?? [])
      const operation = config.target?.kind === 'computed' && config.target.requireManagedCopy
        ? 'managed_copy' as const
        : 'download' as const
      return {
        sourceId: input.sourceContext?.id ?? null,
        songId: song.id,
        songName: song.name,
        artist: albumArtist,
        album: song.album?.name ?? '',
        quality: config.quality,
        jobId: batchId,
        operation,
        executionIntent: {
          downloadMode: config.downloadMode ?? 'full',
          ...(config.target ? { target: config.target } : {}),
          downloadLyrics: config.downloadLyrics,
          embedMetadata: config.embedMetadata,
          embedCover: config.embedCover,
        },
        idempotencyKey: buildDownloadTaskIdempotencyKey({
          songId: song.id,
          operation,
          quality: config.quality,
          downloadDir: config.downloadDir,
          pathFormat: config.pathFormat,
        }),
      }
    }))
    return { batchId, total: taskSubmission.taskIds.length, taskSubmission }
  })()

  if (result.taskSubmission.taskIds.length > 0) result.taskSubmission.wake()
  return {
    batchId: result.batchId,
    total: result.total,
    tasks: result.taskSubmission.tasks.map(({ task, reused }) => ({ taskId: task.id, reused })),
    selectionFailures: input.selection.failures,
  }
}
