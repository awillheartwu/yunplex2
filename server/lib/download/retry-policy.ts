export interface DownloadFailurePolicy {
  pauseReason?: 'authentication' | 'filesystem'
  cooldownMs?: number
}

import { errorSignals } from '../error-signals'
import { classifyDownloadError } from '../sync/download-diagnostics'
import { errorRecoveryMode, FAST_RETRY_DELAY_MS } from '../../../shared/error-recovery'

/** Backpressure stops other pending requests; failed tasks wait for the next source sync. */
export function downloadFailurePolicy(error: unknown): DownloadFailurePolicy {
  const { retryAfterMs } = errorSignals(error)
  const code = classifyDownloadError(error)
  if (errorRecoveryMode(code) === 'paused') {
    if (code === 'filesystem_failed') return { pauseReason: 'filesystem' }
    if (code === 'authentication_failed') return { pauseReason: 'authentication' }
  }
  if (code === 'rate_limited') {
    const retryAfter = retryAfterMs ?? 0
    return { cooldownMs: Math.max(FAST_RETRY_DELAY_MS, Number.isFinite(retryAfter) ? retryAfter : 0) }
  }
  return {}
}
