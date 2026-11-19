import type { DomainErrorCode } from './domain-errors'
import type { RecoveryDecision } from './error-recovery'

export type FailureHandlingStatus = 'open' | 'ignored' | 'resolved'

export interface FailureHandlingState {
  status: FailureHandlingStatus
  ignoreReason: 'automatic' | 'manual' | null
  attemptCount: number
  attemptLimit: number
  errorCode: DomainErrorCode
  recovery?: RecoveryDecision
  automaticRecoveryEnabled?: boolean
  retryable?: boolean
  notApplicable?: boolean
}

export interface RunFailureHandlingState extends FailureHandlingState {
  sourceId: string | null
  songId: number | null
  plexPlaylistRatingKey?: string
  plexPlaylistItemId?: number
}

/** These are run outcomes; the error code describes the underlying cause. */
export function canRetrySong(status: string): boolean {
  return [
    'failed_download',
    'failed_tags',
    'failed_plex_match',
    'failed_plex_insert',
    'copyright_restricted',
    'ignored_failure',
    'awaiting_retry',
  ].includes(status)
}
