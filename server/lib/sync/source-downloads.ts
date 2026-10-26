import { getMediaCorrection } from './media-corrections'
import type { AppConfig } from '../config/types'
import type { JobStepContext } from '../job/types'
import type { SyncState } from '../log/types'
import type { PlaylistSource } from '../playlist/types'
import type { RunBuilder } from '../run/builder'
import {
  buildDownloadTaskIdempotencyKey,
  type DownloadTask,
} from '../download/queue'
import { createFileTaskWaitHandle, getSourceFileRetryTasks, resumeSourceFileTasks, submitFileTasks } from '../download/file-task-command'
import { getDownloadWorker } from '../download/worker'
import { classifyDownloadTaskFailure } from './download-diagnostics'
import { getActiveSongIdentityBindings } from './identity-store'
import { normalizePlexPath } from './identity-normalization'
import { getLocalMediaAsset } from './local-media-store'
import { decideRedownload } from './redownload-policy'
import type { ReadonlyTrackResolution, TrackResolution } from './types'

interface ApplySourceDownloadsInput {
  source: PlaylistSource
  resolutions: readonly ReadonlyTrackResolution[]
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

export interface SourceDownloadResult {
  resolutions: readonly ReadonlyTrackResolution[]
  needsPlexRefresh: boolean
  downloadTargetCount: number
}

interface DownloadPlan {
  resolution: TrackResolution
  mode: 'full' | 'missing' | 'replace'
  retryTasks?: DownloadTask[]
  target?: import('../download/single-song').AudioTargetIntent
}

function sameLocalFilePath(first: string, second: string): boolean {
  return normalizePlexPath(first) === normalizePlexPath(second)
}

/**
 * Apply every local-media write required by one Source Convergence.
 *
 * The caller's comparison stays unchanged. Plex consumes the returned
 * post-download identities and file outcomes explicitly.
 */
export async function applySourceDownloads(input: ApplySourceDownloadsInput): Promise<SourceDownloadResult> {
  const {
    source,
    resolutions: comparedResolutions,
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
  const resolutions = comparedResolutions.map(resolution => ({ ...resolution }))

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
          ? { target: { kind: 'computed' as const, protectedPath: resolution.mediaPolicy.protectedAudioPath, requireManagedCopy: Boolean(!dryRun && getMediaCorrection(resolution.song.id)) } }
          : !dryRun && getMediaCorrection(resolution.song.id) ? {target:{kind:'computed' as const,requireManagedCopy:true}} : {}),
    })
  }

  if (redownloadManagedMedia) {
    const bindings = getActiveSongIdentityBindings(resolutions.map(item => item.song.id))
    for (const resolution of resolutions) {
      if (resolution.resolution === 'ignored_failure') continue
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

  if (!dryRun && !redownloadManagedMedia) {
    const fileRetries = getSourceFileRetryTasks(source.id)
    for (const resolution of resolutions) {
      if (resolution.resolution === 'ignored_failure' || resolution.resolution === 'awaiting_manual') continue
      const correctionId = getMediaCorrection(resolution.song.id)?.id ?? null
      const retryTasks = (fileRetries.get(resolution.song.id) ?? []).filter(task =>
        (task.idempotencyKey?.split(':correction:')[1] ?? null) === correctionId,
      )
      if (retryTasks.length) downloadPlans.set(resolution.song.id, {
        resolution, retryTasks, mode: retryTasks[0]!.executionIntent?.downloadMode ?? 'missing',
      })
    }
  }

  const songsToDownload = [...downloadPlans.values()].map(plan => plan.resolution)
  const needsPlexRefresh = songsToDownload.length > 0 || (!dryRun && resolutions.some(resolution=>Boolean(getMediaCorrection(resolution.song.id)?.staged_asset_json)))
    || resolutions.some(resolution => resolution.resolution === 'found_on_disk')
  const queuedDownloadTasks = new Map<number, DownloadTask>()

  if (!dryRun && songsToDownload.length > 0) {
    const downloadStep = job.startStep(
      'download',
      redownloadManagedMedia ? '重新下载音频' : '下载歌曲',
      { context: stepContext },
    )
    setStage('downloading')

    const retryTaskIds = [...downloadPlans.values()].flatMap(plan => plan.retryTasks
      ? resumeSourceFileTasks(plan.retryTasks, job.getId(), source.id) : [])
    const submitted = submitFileTasks(songsToDownload.filter(resolution => !downloadPlans.get(resolution.song.id)?.retryTasks).map(resolution => {
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
        retryFailed: true,
        operation,
        ...(targetPath ? { targetPath } : {}),
        executionIntent: {
          downloadMode: plan?.mode ?? 'full',
          ...(plan?.target ? { target: plan.target } : {}),
          downloadLyrics: config.download.downloadLyrics,
          embedMetadata: config.download.embedMetadata,
          embedCover: config.download.embedCover,
          saveAlbumCover: config.download.saveAlbumCover,
          saveArtistImage: config.download.saveArtistImage,
        },
        idempotencyKey: buildDownloadTaskIdempotencyKey({
          songId: resolution.song.id,
          operation,
          quality: config.netease.quality,
          downloadDir: config.download.dir,
          pathFormat: config.other?.pathFormat ?? '{artist}/{album} ({year})/{title}',
        }) + (getMediaCorrection(resolution.song.id) ? `:correction:${getMediaCorrection(resolution.song.id)!.id}` : ''),
      }
    }))
    for (const { task } of submitted.tasks) {
      queuedDownloadTasks.set(task.songId, task)
    }
    const fileTaskHandle = createFileTaskWaitHandle([...submitted.taskIds, ...retryTaskIds])

    const worker = getDownloadWorker()
    if (!worker) throw new Error('下载消费者尚未启动')
    fileTaskHandle.wake()
    await fileTaskHandle.wait({
      throwIfCancelled,
    })
    throwIfCancelled()
    queuedDownloadTasks.clear()
    for (const task of fileTaskHandle.readResults()) {
      if (queuedDownloadTasks.get(task.songId)?.status !== 'failed') queuedDownloadTasks.set(task.songId, task)
    }
    setStage('processing_tags')

    for (const resolution of resolutions.filter(item => downloadPlans.has(item.song.id))) {
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
                  code: diagnosis.errorCode,
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
          (task.operation === 'replace' || task.executionIntent?.downloadMode === 'replace')
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
            quality: task.quality ?? config.netease.quality,
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

  return { resolutions, needsPlexRefresh, downloadTargetCount: songsToDownload.length }
}
