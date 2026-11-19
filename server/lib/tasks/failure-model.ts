import type { AppConfig } from '../config/types'
import type { TaskRunType } from '../job/types'
import type { DomainErrorCategory, DomainErrorCode, DomainErrorSeverity } from '../../../shared/domain-errors'
import { resolveDomainErrorDefinition } from '../../../shared/domain-errors'
import { recoveryDecision, type RecoveryDecision } from '../../../shared/error-recovery'
import { sanitizeDiagnosticMessage } from '../domain-error'

export type FailureRecordStatus = 'open' | 'ignored' | 'resolved'
export type FailureRecordStatusFilter = FailureRecordStatus | 'all'

export interface FailureRecord {
  id: string
  fingerprint: string
  subjectKey: string
  songId: number | null
  songName: string
  artist: string
  sourceId: string | null
  sourceName: string
  runId: string | null
  runType: TaskRunType
  failureKind: string
  failureReason: string
  errorCode: DomainErrorCode
  errorCategory: DomainErrorCategory
  errorSeverity: DomainErrorSeverity
  retryable: boolean
  userMessage: string
  status: FailureRecordStatus
  firstSeenAt: string
  lastSeenAt: string
  ignoredAt: string | null
  resolvedAt: string | null
  occurrenceCount: number
  attemptCount: number
  attemptLimit: number
  ignoreReason: 'automatic' | 'manual' | null
  retryCount: number
  downloadTaskIds: string[]
  recovery?: RecoveryDecision
  automaticRecoveryEnabled?: boolean
  notApplicable?: boolean
}

export interface FailureRecordFilter {
  status?: FailureRecordStatusFilter
  type?: TaskRunType
  failureKind?: string
  excludeFailureKinds?: string[]
  sourceId?: string
  runId?: string
  groupId?: string
  groupKey?: string
  search?: string
  from?: string
  to?: string
  timeZone?: string
  limit?: number
  offset?: number
}

/** Read models and SQL selection must classify historical causes identically. */
export function failureDefinition(kind: string, reason: unknown) {
  return resolveDomainErrorDefinition(kind, sanitizeDiagnosticMessage(reason))
}

export function rowToRecord(row: Record<string, unknown>, config: AppConfig): FailureRecord {
  const attemptLimit = config.sync.maxFailureAttempts
  const rawFirstSeenAt = String(row.first_seen_at)
  const rawLastSeenAt = String(row.last_seen_at)
  const firstSeenAt = rawFirstSeenAt <= rawLastSeenAt ? rawFirstSeenAt : rawLastSeenAt
  const lastSeenAt = rawFirstSeenAt <= rawLastSeenAt ? rawLastSeenAt : rawFirstSeenAt

  const failureKind = String(row.failure_kind)
  const failureReason = sanitizeDiagnosticMessage(row.failure_reason) || ''
  const definition = failureDefinition(failureKind, failureReason)
  const status = String(row.status) as FailureRecordStatus
  const sourceId = row.source_id === null ? null : String(row.source_id)
  const songId = row.song_id === null ? null : Number(row.song_id)
  const downloadTaskIds = String(row.download_task_ids || '').split(',').filter(Boolean)
  return {
    id: String(row.id),
    fingerprint: String(row.fingerprint),
    subjectKey: String(row.subject_key),
    songId,
    songName: String(row.song_name),
    artist: String(row.artist || ''),
    sourceId,
    sourceName: String(row.source_name || ''),
    runId: row.run_id === null ? null : String(row.run_id),
    runType: String(row.run_type) as TaskRunType,
    failureKind: definition.code,
    failureReason,
    errorCode: definition.code,
    errorCategory: definition.category,
    errorSeverity: definition.severity,
    notApplicable: Boolean(row.left_source),
    retryable: Boolean(row.retry_target_available),
    userMessage: definition.userMessage,
    status,
    firstSeenAt,
    lastSeenAt,
    ignoredAt: row.ignored_at === null ? null : String(row.ignored_at),
    resolvedAt: row.resolved_at === null ? null : String(row.resolved_at),
    occurrenceCount: Number(row.occurrence_count),
    attemptCount: Number(row.attempt_count),
    attemptLimit,
    automaticRecoveryEnabled: row.run_type !== 'sync' || (config.sync.enabled && row.source_enabled !== 0),
    recovery: recoveryDecision({ errorCode: definition.code, status, attemptCount: Number(row.attempt_count), attemptLimit, lastSeenAt }),
    ignoreReason: row.ignore_reason === 'automatic' || row.ignore_reason === 'manual' ? row.ignore_reason : null,
    retryCount: Number(row.retry_count),
    downloadTaskIds,
  }
}
