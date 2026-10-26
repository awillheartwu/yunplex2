import type { DownloadTask } from '../download/queue'
import type { SongStatus, SongTask } from '../job/types'
import type { TrackResolution } from './types'
import type { DomainErrorCode } from '../../../shared/domain-errors'
import { getDomainErrorDefinition, isTagFailureMessage } from '../../../shared/domain-errors'
import { classifyErrorCode } from '../domain-error'

type DownloadFailureStatus = Extract<SongStatus, 'failed_download' | 'failed_tags' | 'copyright_restricted'>
type DownloadFailurePhase = Extract<SongTask['phase'], 'download' | 'tags'>

export interface DownloadFailureDiagnosis {
  status: DownloadFailureStatus
  phase: DownloadFailurePhase
  title: string
  shouldRecordFailure: boolean
  shouldAttemptPlexRetry: boolean
  errorCode: DomainErrorCode
  retryable: boolean
}

export function classifyDownloadFailure(
  message: string | null | undefined, filePath?: string | null,
): DownloadFailureDiagnosis {
  return diagnosisFromCode(classifyErrorCode(message, 'failed_download'), filePath,
    isTagFailureMessage(message) ? 'tags' : undefined)
}

export function classifyDownloadError(error: unknown): DomainErrorCode {
  return classifyErrorCode(error, 'failed_download')
}

function diagnosisFromCode(code: DomainErrorCode, filePath?: string | null, errorPhase?: DownloadFailurePhase): DownloadFailureDiagnosis {
  const definition = getDomainErrorDefinition(code)
  const status = code === 'copyright_restricted'
    ? 'copyright_restricted'
    : code === 'failed_tags' || errorPhase === 'tags'
      ? 'failed_tags'
      : 'failed_download'
  return {
    status,
    phase: status === 'failed_tags' ? 'tags' : 'download',
    title: status === 'copyright_restricted'
      ? '歌曲不可用'
      : status === 'failed_tags'
        ? '标签写入失败'
        : definition.label,
    shouldRecordFailure: status !== 'copyright_restricted',
    shouldAttemptPlexRetry: status === 'failed_tags' && Boolean(filePath),
    errorCode: code,
    retryable: definition.retryable,
  }
}

export function classifyDownloadTaskFailure(task: Pick<DownloadTask, 'errorCode' | 'errorPhase' | 'error' | 'filePath'> | null | undefined): DownloadFailureDiagnosis {
  if (task?.errorCode) return diagnosisFromCode(task.errorCode, task.filePath, task.errorPhase)
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
