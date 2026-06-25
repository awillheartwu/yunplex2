import type { DownloadTask } from '../download/queue'
import type { SongStatus, SongTask } from '../job/types'
import type { TrackResolution } from './types'

type DownloadFailureStatus = Extract<SongStatus, 'failed_download' | 'failed_tags' | 'copyright_restricted'>
type DownloadFailurePhase = Extract<SongTask['phase'], 'download' | 'tags'>

export interface DownloadFailureDiagnosis {
  status: DownloadFailureStatus
  phase: DownloadFailurePhase
  title: string
  shouldRecordFailure: boolean
  shouldAttemptPlexRetry: boolean
}

function includesAny(message: string, patterns: string[]) {
  return patterns.some((pattern) => message.includes(pattern))
}

export function isCopyrightFailureMessage(message: string | null | undefined): boolean {
  if (!message) return false
  return includesAny(message, ['无法获取歌曲', '下载链接'])
}

export function isTagFailureMessage(message: string | null | undefined): boolean {
  if (!message) return false
  return includesAny(message, ['标签写入失败', '标签写入 超时', 'FLAC 标签写入', 'MP3 标签写入'])
}

export function classifyDownloadFailure(
  message: string | null | undefined,
  filePath?: string | null,
): DownloadFailureDiagnosis {
  if (isCopyrightFailureMessage(message)) {
    return {
      status: 'copyright_restricted',
      phase: 'download',
      title: '歌曲不可用',
      shouldRecordFailure: false,
      shouldAttemptPlexRetry: false,
    }
  }

  if (isTagFailureMessage(message)) {
    return {
      status: 'failed_tags',
      phase: 'tags',
      title: '标签写入失败',
      shouldRecordFailure: true,
      shouldAttemptPlexRetry: Boolean(filePath),
    }
  }

  return {
    status: 'failed_download',
    phase: 'download',
    title: '下载失败',
    shouldRecordFailure: true,
    shouldAttemptPlexRetry: false,
  }
}

export function classifyDownloadTaskFailure(task: DownloadTask | null | undefined): DownloadFailureDiagnosis {
  return classifyDownloadFailure(task?.error, task?.filePath)
}

export function shouldAttemptPlexRetryForResolution(
  resolution: TrackResolution['resolution'],
  songStatus: SongStatus | undefined,
  filePath?: string | null,
): boolean {
  if (resolution === 'found_on_disk') return true
  if (resolution !== 'needs_download') return false

  return songStatus === 'success'
    || (songStatus === 'failed_tags' && Boolean(filePath))
}
