import type { AppConfig } from '../config/types'
import type { JobStepContext } from '../job/types'
import type { SyncState } from '../log/types'
import type { PlaylistSource } from '../playlist/types'
import type { RunBuilder } from '../run/builder'
import {
  buildDownloadTaskIdempotencyKey,
  type DownloadTask,
} from '../download/queue'
import { submitFileTasks } from '../download/file-task-command'
import { getDownloadWorker } from '../download/worker'
import { classifyDownloadTaskFailure } from './download-diagnostics'
import { getActiveSongIdentityBindings } from './identity-store'
import { normalizePlexPath } from './identity-normalization'
import { getLocalMediaAsset } from './local-media-store'
import { decideRedownload } from './redownload-policy'
import type { TrackResolution } from './types'

interface ApplySourceDownloadsInput {
  source: PlaylistSource
  resolutions: TrackResolution[]
  config: AppConfig
  job: RunBuilder
  stepContext: JobStepContext
  dryRun: boolean
  redownloadManagedMedia: boolean
  takeOverExternal: boolean
  splitArtists: (artists: { name: string }[]) => [string, string]
  throwIfCancelled: () => void
  setStage: (stage: SyncState['currentStage']) => void
  addFailure: (songName: string, reason: string) => void
  log: (level: 'warn' | 'error', message: string, detail?: string) => void
}

interface DownloadPlan {
  resolution: TrackResolution
  mode: 'full' | 'replace'
  target?: import('../download/single-song').AudioTargetIntent
}

function sameLocalFilePath(first: string, second: string): boolean {
  return normalizePlexPath(first) === normalizePlexPath(second)
}

/**
 * Apply every local-media write required by one Source Convergence.
 *
 * The input Track Resolutions are updated in place because Plex reconciliation
 * must consume the exact post-download identity and failure state.
 */
export async function applySourceDownloads(input: ApplySourceDownloadsInput): Promise<{
  needsPlexRefresh: boolean
  downloadTargetCount: number
}> {
  const {
    source,
    resolutions,
    config,
    job,
    stepContext,
    dryRun,
    redownloadManagedMedia,
    takeOverExternal,
    splitArtists,
    throwIfCancelled,
    setStage,
    addFailure,
    log,
  } = input

  const downloadPlans = new Map<number, DownloadPlan>()
  for (const resolution of resolutions) {
    if (resolution.resolution !== 'needs_download' || downloadPlans.has(resolution.song.id)) continue
    const replace = resolution.mediaPolicy?.disposition === 'redownload_replaced'
    downloadPlans.set(resolution.song.id, {
      resolution,
      mode: replace ? 'replace' : 'full',
      ...(resolution.mediaPolicy?.audioPath
        ? { target: { kind: 'existing' as const, path: resolution.mediaPolicy.audioPath } }
        : resolution.mediaPolicy?.protectedAudioPath
          ? { target: { kind: 'computed' as const, protectedPath: resolution.mediaPolicy.protectedAudioPath } }
          : {}),
    })
  }

  if (redownloadManagedMedia) {
    const bindings = getActiveSongIdentityBindings(resolutions.map(item => item.song.id))
    for (const resolution of resolutions) {
      if (downloadPlans.get(resolution.song.id)?.mode === 'replace') continue
      const decision = decideRedownload({
        asset: getLocalMediaAsset(resolution.song.id),
        binding: bindings.get(resolution.song.id) ?? null,
        takeOverExternal,
      })
      if (!decision.eligible) {
        continue
      }
      downloadPlans.set(resolution.song.id, {
        resolution,
        mode: 'replace',
        ...(decision.audioPath ? { target: { kind: 'existing' as const, path: decision.audioPath } } : {}),
      })
    }
  }

  const songsToDownload = [...downloadPlans.values()].map(plan => plan.resolution)
  const needsPlexRefresh = songsToDownload.length > 0
    || resolutions.some(resolution => resolution.resolution === 'found_on_disk')
  const queuedDownloadTasks = new Map<number, DownloadTask>()

  if (!dryRun && songsToDownload.length > 0) {
    const downloadStep = job.startStep(
      'download',
      redownloadManagedMedia ? '重新下载音频' : '下载歌曲',
      { context: stepContext },
    )
    setStage('downloading')

    const fileTaskHandle = submitFileTasks(songsToDownload.map(resolution => {
      const [, trackArtist] = splitArtists(resolution.song.artists)
      const operation = downloadPlans.get(resolution.song.id)?.mode === 'replace'
        ? 'replace' as const
        : 'download' as const
      const plan = downloadPlans.get(resolution.song.id)
      const targetPath = plan?.target?.kind === 'existing'
        ? plan.target.path
        : plan?.target?.protectedPath
      return {
        sourceId: source.id,
        songId: resolution.song.id,
        songName: resolution.song.name,
        artist: trackArtist || splitArtists(resolution.song.artists)[0],
        album: resolution.song.album.name,
        quality: config.netease.quality,
        jobId: job.getId(),
        operation,
        ...(targetPath ? { targetPath } : {}),
        executionIntent: {
          downloadMode: plan?.mode ?? 'full',
          ...(plan?.target ? { target: plan.target } : {}),
          downloadLyrics: config.download.downloadLyrics,
          embedMetadata: config.download.embedMetadata,
          embedCover: config.download.embedCover,
        },
        idempotencyKey: buildDownloadTaskIdempotencyKey({
          songId: resolution.song.id,
          operation,
          quality: config.netease.quality,
          downloadDir: config.download.dir,
          pathFormat: config.other?.pathFormat ?? '{artist}/{album} ({year})/{title}',
        }),
      }
    }))
    for (const { task } of fileTaskHandle.tasks) {
      queuedDownloadTasks.set(task.songId, task)
    }

    const worker = getDownloadWorker()
    if (!worker) throw new Error('下载消费者尚未启动')
    fileTaskHandle.wake()
    await fileTaskHandle.wait({
      throwIfCancelled,
    })
    throwIfCancelled()
    queuedDownloadTasks.clear()
    for (const task of fileTaskHandle.readResults()) queuedDownloadTasks.set(task.songId, task)
    setStage('processing_tags')

    for (const resolution of songsToDownload) {
      const songId = job.findSongIdByIndex(source.id, resolution.neteaseIndex)
        ?? job.findSongId(source.id, resolution.song.id)
      if (!songId) continue

      const task = queuedDownloadTasks.get(resolution.song.id) ?? null
      if (!task || task.status === 'failed') {
        const diagnosis = classifyDownloadTaskFailure(task)
        const artist = splitArtists(resolution.song.artists)[0]
        const resolvedFilePath = task?.filePath ?? resolution.filePath
        if (resolvedFilePath) resolution.filePath = resolvedFilePath

        job.updateSong(songId, {
          status: diagnosis.status,
          phase: diagnosis.phase,
          filePath: resolvedFilePath ?? undefined,
          fileType: task?.fileType ?? undefined,
          ...(task?.error
            ? {
                error: {
                  title: diagnosis.title,
                  message: task.error,
                  stage: diagnosis.phase,
                  songName: resolution.song.name,
                  artist,
                },
              }
            : {}),
        })
        if (task?.error) {
          if (diagnosis.status === 'failed_tags') {
            addFailure(resolution.song.name, task.error)
            log('error', `标签写入失败: ${resolution.song.name}`, task.error)
          } else if (diagnosis.status !== 'copyright_restricted') {
            addFailure(resolution.song.name, task.error)
            log('error', `下载失败: ${resolution.song.name}`, task.error)
          }
        }
      } else if (task.status === 'done') {
        const previousFilePath = resolution.filePath
        resolution.filePath = task.filePath ?? resolution.filePath
        if (
          downloadPlans.get(resolution.song.id)?.mode === 'replace'
          && resolution.filePath
          && (!previousFilePath || !sameLocalFilePath(previousFilePath, resolution.filePath))
        ) {
          resolution.resolution = 'found_on_disk'
          resolution.plexRatingKey = undefined
        }
        job.updateSong(songId, {
          status: 'success',
          phase: 'done',
          filePath: task.filePath,
          fileType: task.fileType,
          metadata: {
            trackNumber: resolution.song.no,
            quality: config.netease.quality,
            duration: resolution.song.dt,
            disc: resolution.song.disc || '1',
          },
        })
      }
    }

    const okCount = songsToDownload.filter((resolution) => {
      const song = job.getSongByIndex(source.id, resolution.neteaseIndex)
        ?? job.getSong(source.id, resolution.song.id)
      return song?.status === 'success'
    }).length
    const failCount = songsToDownload.length - okCount
    job.finishStep(downloadStep, failCount > 0 ? 'partial' : 'success', `${okCount} 首成功，${failCount} 首失败`)
  } else if (dryRun && songsToDownload.length > 0) {
    const downloadStep = job.startStep(
      'download',
      redownloadManagedMedia ? '重新下载音频' : '下载歌曲',
      { context: stepContext },
    )
    job.finishStep(downloadStep, 'success', `[预览] 共 ${songsToDownload.length} 首`)
  }

  for (const resolution of resolutions) {
    if (resolution.resolution !== 'needs_download') continue
    const task = queuedDownloadTasks.get(resolution.song.id) ?? null
    const diagnosis = classifyDownloadTaskFailure(task)
    if (task?.filePath && !resolution.filePath) resolution.filePath = task.filePath
    if (task?.status === 'failed' && diagnosis.status === 'copyright_restricted') {
      resolution.resolution = 'copyright_restricted'
    }
  }

  return { needsPlexRefresh, downloadTargetCount: songsToDownload.length }
}
