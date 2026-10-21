import type { DownloadTask } from '../download/queue'
import type { SongStatus, SongTask } from '../job/types'
import type { TrackResolution } from './types'
import type { DomainErrorCode } from '../../../shared/domain-errors'
import { classifyDomainErrorCode, getDomainErrorDefinition } from '../../../shared/domain-errors'
import { errorSignals } from '../download/retry-policy'

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

function includesAny(message: string, patterns: string[]) {
  return patterns.some((pattern) => message.includes(pattern))
}

export function isCopyrightFailureMessage(message: string | null | undefined): boolean {
  if (!message) return false
  return /版权|copyright|COPYRIGHT_RESTRICTED/i.test(message)
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
      errorCode: 'copyright_restricted',
      retryable: false,
    }
  }

  if (isTagFailureMessage(message)) {
    return {
      status: 'failed_tags',
      phase: 'tags',
      title: '标签写入失败',
      shouldRecordFailure: true,
      shouldAttemptPlexRetry: Boolean(filePath),
      errorCode: 'failed_tags',
      retryable: true,
    }
  }

  const errorCode = classifyDomainErrorCode(message, 'failed_download')
  return {
    status: 'failed_download',
    phase: 'download',
    title: '下载失败',
    shouldRecordFailure: true,
    shouldAttemptPlexRetry: false,
    errorCode,
    retryable: getDomainErrorDefinition(errorCode).retryable,
  }
}

export function classifyDownloadError(error: unknown): DomainErrorCode {
  const { code, message, status } = errorSignals(error)
  if (/ENOSPC|EACCES|EPERM|EROFS/.test(code) || /磁盘.*(?:满|空间)|空间不足|只读文件系统/.test(message)) {
    return 'filesystem_failed'
  }
  if (status === 401 || /AUTHENTICATION_FAILED/.test(code)
    || /登录状态|登录.*(?:失效|过期)|未登录|认证失效|cookie.*(?:失效|过期)|unauthori[sz]ed/.test(message)) {
    return 'authentication_failed'
  }
  if (status === 429 || /限流|请求.*频繁|rate.?limit|too many requests/.test(message)) return 'rate_limited'
  if (/版权|copyright_restricted/i.test(`${code} ${message}`)) return 'copyright_restricted'
  if (/MEDIA_IDENTITY_CONFLICT/.test(code)) return 'media_identity_conflict'
  if (/SONG_URL_UNAVAILABLE/.test(code) || /未提供.*可用音源|音源状态\s*404|试听音源|账号权限/.test(message)) {
    return 'source_unavailable'
  }
  if (/DOWNLOAD_FORMAT_UNSUPPORTED/.test(code) || /尚不支持|不支持的音频格式/.test(message)) return 'unsupported_format'
  if (/DOWNLOAD_INVALID_AUDIO|INVALID_AUDIO/.test(code) || /文件头无效|音频文件无效|下载的音频文件无效/.test(message)) {
    return 'invalid_audio'
  }
  if (/标签写入失败|FLAC 标签写入|MP3 标签写入/.test(message)) return 'failed_tags'
  if (status >= 500 || /NETEASE_REQUEST_FAILED|NETEASE_INITIALIZATION_FAILED|连接失败|请求超时|ETIMEDOUT|ECONN|ENET|EHOST|EAI_AGAIN|UND_ERR|fetch failed|socket|超时|timeout/.test(`${code} ${message}`)) {
    return 'netease_unavailable'
  }
  return 'failed_download'
}

function diagnosisFromCode(code: DomainErrorCode, message: string | undefined, filePath?: string | null): DownloadFailureDiagnosis {
  const definition = getDomainErrorDefinition(code)
  const status = code === 'copyright_restricted'
    ? 'copyright_restricted'
    : code === 'failed_tags'
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

export function classifyDownloadTaskFailure(task: DownloadTask | null | undefined): DownloadFailureDiagnosis {
  if (task?.errorCode) return diagnosisFromCode(task.errorCode, task.error, task.filePath)
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
