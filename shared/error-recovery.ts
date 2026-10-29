import type { DomainErrorCode } from './domain-errors'

export type RecoveryAction = 'retry' | 'paused' | 'manual' | 'ignored' | 'resolved'
export interface RecoveryDecision {
  action: RecoveryAction
  nextRetryAt: string | null
}
export const FAST_RETRY_DELAY_MS = 30_000

/** Execution policy; problem status only records unresolved, ignored or resolved. */
const RECOVERY_ACTIONS: Record<DomainErrorCode, 'retry' | 'paused' | 'manual'> = {
  copyright_restricted: 'manual', authentication_failed: 'paused', plex_authentication_failed: 'paused',
  rate_limited: 'retry', netease_unavailable: 'retry', plex_unavailable: 'retry', plex_write_uncertain: 'manual',
  filesystem_failed: 'paused', media_identity_conflict: 'manual',
  scheduler_interrupted: 'retry', concurrent_operation: 'retry',
  failed_download: 'retry', failed_tags: 'retry', failed_plex_match: 'retry', failed_plex_insert: 'retry',
  source_unavailable: 'manual', source_missing: 'retry', invalid_audio: 'retry',
  unsupported_format: 'manual', validation_failed: 'manual', unknown_error: 'retry',
}

export function errorRecoveryMode(code: DomainErrorCode): 'retry' | 'paused' | 'manual' {
  return RECOVERY_ACTIONS[code]
}

export function recoveryDecision(input: {
  errorCode: DomainErrorCode
  status?: 'open' | 'ignored' | 'resolved'
  attemptCount: number
  attemptLimit: number
  lastSeenAt: string
  retryAfterMs?: number
}): RecoveryDecision {
  if (input.status === 'resolved') return { action: 'resolved', nextRetryAt: null }
  if (input.status === 'ignored') return { action: 'ignored', nextRetryAt: null }
  if (input.attemptCount === 0) return { action: 'retry', nextRetryAt: input.lastSeenAt }
  const action = errorRecoveryMode(input.errorCode)
  if (action !== 'retry') return { action, nextRetryAt: null }
  // The fast-attempt budget changes frequency, never the user's ignore choice.
  const exhausted = input.attemptCount >= input.attemptLimit
  const base = exhausted ? 60 * 60_000 : FAST_RETRY_DELAY_MS
  const exponent = exhausted ? input.attemptCount - input.attemptLimit : input.attemptCount - 1
  const delay = Math.max(input.retryAfterMs ?? 0, Math.min(6 * 60 * 60_000, base * 2 ** Math.min(10, Math.max(0, exponent))))
  return { action, nextRetryAt: new Date(Date.parse(input.lastSeenAt) + delay).toISOString() }
}

export function recoveryIsDue(decision: RecoveryDecision, now = Date.now()): boolean {
  return decision.action === 'retry' && (!decision.nextRetryAt || Date.parse(decision.nextRetryAt) <= now)
}
