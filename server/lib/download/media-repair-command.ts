import { join } from 'node:path'
import dayjs from 'dayjs'
import { readConfig } from '../config/store'
import type { AppConfig } from '../config/types'
import { appendLog } from '../log/store'
import {
  fetchAlbumSongs,
  fetchPlaylistSongs,
  fetchSongDetail,
  setArtistAliases,
} from '../netease'
import { getSource } from '../playlist/store'
import { getSectionKey, initPlexClient, refreshLibrary } from '../plex-client'
import { createRepairRun, getRun, saveRun, syncRepairRun } from '../run/store'
import { createSplitArtists } from '../sync/artist-utils'
import { emitEvent } from '../sync/events'
import { getSongIdentityBinding } from '../sync/identity-store'
import { findExistingLocalSongPath } from '../sync/local-file-discovery'
import { getLocalMediaAsset } from '../sync/local-media-store'
import { getSyncServiceInstance, setRepairRunning } from '../sync/instance'
import { resolveAccessibleLocalPath } from '../sync/path-map'
import { sourceRequestsBusy } from '../sync/request-store'
import { buildDownloadPath } from '../tag-writer'
import {
  buildDownloadTaskIdempotencyKey,
} from './queue'
import {
  createFileTaskWaitHandle,
  submitFileTasks,
  type FileTaskSubmissionHandle,
} from './file-task-command'
import { getDb } from '../db'
import { createFileTaskSchema } from '../db/file-task-schema'
import { randomUUID } from 'node:crypto'

interface RepairTarget {
  songId: number
  songName: string
  artist: string
  album: string
  path: string
}

let activeRepairPromise: Promise<void> | null = null
let repairStarting = false
let repairStopping = false

export async function startMediaRepairCommand(sourceId: string): Promise<{
  jobId: string
  sourceId: string
  totalSongs: number
  queuedSongs: number
  skippedSongs: number
}> {
  if (repairStarting || activeRepairPromise) throw new Error('已有补全任务在运行中，请等待完成')
  const source = getSource(sourceId)
  if (!source) throw new Error('歌单源不存在')
  if (getSyncServiceInstance().getState().isRunning) throw new Error('已有同步任务在运行中，请等待完成')
  if (sourceRequestsBusy()) throw new Error('已有来源请求在队列中，请等待完成')

  repairStarting = true
  repairStopping = false
  setRepairRunning(true)
  try {
    const cfg = readConfig()
    setArtistAliases(cfg.other.artistAliases ?? {}, cfg.other.applyAliasToAlbum ?? false)
    const songs = source.type === 'album'
      ? await fetchAlbumSongs(source.neteasePlaylistId, cfg.netease.cookie)
      : (await fetchPlaylistSongs(
          source.neteasePlaylistId,
          source.syncLimit == null || source.syncLimit === 0 ? undefined : source.syncLimit,
          cfg.netease.cookie,
        )).songs

    const targets: RepairTarget[] = []
    for (const song of songs) {
      const target = await resolveRepairTarget(song.id, cfg)
      if (target) targets.push(target)
    }

    const jobId = randomUUID().slice(0, 12)
    const skippedSongs = songs.length - targets.length
    const taskHandle = getDb().transaction(() => {
      createRepairRun({
        id: jobId,
        total: songs.length,
        skipped: skippedSongs,
        sourceId: source.id,
        sourceLabel: source.name || source.neteasePlaylistName || String(source.neteasePlaylistId),
      })
      const fileTaskHandle = submitFileTasks(targets.map(target => ({
        sourceId: source.id,
        songId: target.songId,
        songName: target.songName,
        artist: target.artist,
        album: target.album,
        quality: cfg.netease.quality,
        jobId,
        operation: 'repair_existing',
        targetPath: target.path,
        executionIntent: {
          downloadMode: 'missing',
          target: { kind: 'existing', path: target.path },
          downloadLyrics: cfg.download.downloadLyrics,
          embedMetadata: true,
          embedCover: false,
        },
        idempotencyKey: buildDownloadTaskIdempotencyKey({
          songId: target.songId,
          operation: 'repair_existing',
          quality: cfg.netease.quality,
          downloadDir: cfg.download.dir,
          pathFormat: cfg.other.pathFormat,
        }),
      })))
      return fileTaskHandle
    })()
    emitEvent({
      type: 'stage-change',
      data: { stage: 'repair', sourceId: source.id, jobId },
      timestamp: new Date().toISOString(),
    })

    if (taskHandle.taskIds.length === 0) {
      syncRepairRun(jobId)
      emitRepairProgress(jobId, source.id, songs.length, songs.length, true)
      emitIdle(jobId, source.id)
      setRepairRunning(false)
    } else {
      activeRepairPromise = processRepairRuns([{ runId: jobId, taskHandle }])
    }
    repairStarting = false

    return {
      jobId,
      sourceId: source.id,
      totalSongs: songs.length,
      queuedSongs: taskHandle.taskIds.length,
      skippedSongs,
    }
  } catch (error) {
    repairStarting = false
    setRepairRunning(false)
    throw error
  }
}

export function resumePendingMediaRepairCommands(): boolean {
  if (repairStarting || activeRepairPromise) return false
  repairStopping = false
  const db = getDb()
  createFileTaskSchema(db)
  const rows = getDb().prepare(`
      SELECT run.id AS run_id
      FROM task_runs run
      WHERE run.type = 'repair' AND run.status = 'running'
      AND EXISTS (
        SELECT 1 FROM download_tasks task
        WHERE (
          EXISTS (
            SELECT 1 FROM run_file_tasks linked
            WHERE linked.run_id = run.id AND linked.task_id = task.id
          )
          OR COALESCE(task.run_id, task.job_id) = run.id
        )
          AND task.operation = 'repair_existing'
      )
    ORDER BY run.started_at ASC
  `).all() as Array<{ run_id: string }>
  const runs = rows.map(({ run_id }) => ({
    runId: run_id,
    taskHandle: createFileTaskWaitHandle(getDb().prepare(`
      SELECT task.id
      FROM download_tasks task
      WHERE (
        EXISTS (
          SELECT 1 FROM run_file_tasks linked
          WHERE linked.run_id = ? AND linked.task_id = task.id
        )
        OR COALESCE(task.run_id, task.job_id) = ?
      )
        AND task.operation = 'repair_existing'
      ORDER BY task.created_at ASC
    `).all(run_id, run_id).map((row: unknown) => (row as { id: string }).id)),
  }))
  if (runs.length === 0) return false
  setRepairRunning(true)
  activeRepairPromise = processRepairRuns(runs)
  return true
}

export async function waitForMediaRepairCommands(): Promise<void> {
  await activeRepairPromise
}

export async function stopMediaRepairCommands(): Promise<void> {
  if (!activeRepairPromise) {
    repairStopping = false
    return
  }
  repairStopping = true
  await activeRepairPromise
}

async function processRepairRuns(runs: Array<{ runId: string; taskHandle: FileTaskSubmissionHandle }>): Promise<void> {
  try {
    for (const { runId, taskHandle } of runs) {
      const run = getRun(runId)
      if (!run || run.type !== 'repair') continue
      const sourceId = run.sourceIds?.[0]
      if (!sourceId) continue
      emitEvent({
        type: 'stage-change',
        data: { stage: 'repair', sourceId, jobId: runId },
        timestamp: new Date().toISOString(),
      })
      const cfg = readConfig()
      let settled = run.skippedSongs

      taskHandle.wake()
      await taskHandle.wait({
        throwIfCancelled: () => {
          if (repairStopping) throw new Error('补全任务因服务停止而暂停')
        },
        onProgress: (progress) => {
          settled = run.skippedSongs + progress.settled
          emitRepairProgress(runId, sourceId, settled, run.totalSongs, false)
        },
      })

      if (repairStopping) throw new Error('补全任务因服务停止而暂停')
      const staged = syncRepairRun(runId, { finalize: false })
      if (staged && staged.successSongs > 0) {
        await requestPlexRefresh(staged, cfg)
      }
      if (repairStopping) throw new Error('补全任务因服务停止而暂停')
      const updated = syncRepairRun(runId, { finalize: true })
      emitRepairProgress(runId, sourceId, updated?.totalSongs ?? settled, updated?.totalSongs ?? settled, true)
      emitIdle(runId, sourceId)
    }
  } catch (error) {
    if (!repairStopping) {
      appendLog({
        level: 'error',
        message: '[补全] 持久任务处理异常中断',
        detail: error instanceof Error ? error.message : String(error),
        stage: 'repair',
      })
    }
  } finally {
    activeRepairPromise = null
    setRepairRunning(false)
    repairStopping = false
  }
}

async function resolveRepairTarget(songId: number, cfg: AppConfig): Promise<RepairTarget | null> {
  try {
    const song = await fetchSongDetail(songId, cfg.netease.cookie)
    const splitArtists = createSplitArtists(cfg.other.multiArtistFormat)
    const [albumArtist, trackArtist] = splitArtists(song.artists)
    const discoveredPath = findExistingLocalSongPath(song, cfg)
    const computedPath = join(cfg.download.dir, buildDownloadPath(
      cfg.other.pathFormat,
      {
        artist: albumArtist,
        album: song.album.name,
        title: song.name,
        year: song.album.publishTime > 0 ? dayjs(song.album.publishTime).format('YYYY') : '',
        track: String(song.no),
        'track:02d': String(song.no).padStart(2, '0'),
        songId: String(song.id),
      },
      'mp3',
    ))
    const localAsset = getLocalMediaAsset(song.id)
    const binding = getSongIdentityBinding(song.id)
    const path = discoveredPath
      ?? resolveAccessibleLocalPath(localAsset?.filePath, cfg)
      ?? resolveAccessibleLocalPath(computedPath, cfg)
      ?? resolveAccessibleLocalPath(binding?.plexFilePath, cfg)
    if (!path) return null
    return {
      songId: song.id,
      songName: song.name,
      artist: trackArtist || albumArtist,
      album: song.album.name,
      path,
    }
  } catch {
    return null
  }
}

async function requestPlexRefresh(run: NonNullable<ReturnType<typeof getRun>>, cfg: AppConfig): Promise<void> {
  try {
    await initPlexClient(cfg.plex)
    const sectionKey = await getSectionKey(cfg.plex.section)
    if (!sectionKey) throw new Error(`未找到 Plex 音乐库「${cfg.plex.section}」`)
    await refreshLibrary(sectionKey)
  } catch (error) {
    run.warnings += 1
    run.summary += '，Plex 刷新请求失败'
    saveRun(run)
    appendLog({
      level: 'warn',
      message: '[补全] Plex 刷新请求失败',
      detail: error instanceof Error ? error.message : String(error),
      stage: 'refreshing_plex',
    })
  }
}

function emitRepairProgress(
  jobId: string,
  sourceId: string,
  processed: number,
  totalSongs: number,
  finished: boolean,
): void {
  emitEvent({
    type: 'repair-progress',
    data: { jobId, sourceId, processed, totalSongs, finished },
    timestamp: new Date().toISOString(),
  })
}

function emitIdle(jobId: string, sourceId: string): void {
  emitEvent({
    type: 'stage-change',
    data: { stage: 'idle', sourceId, jobId },
    timestamp: new Date().toISOString(),
  })
}
