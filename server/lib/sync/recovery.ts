import type { AppConfig } from '../config/types'
import { getDb } from '../db'
import { getSource } from '../playlist/store'
import { failureSubjectKey, plexRemovalTarget } from '../tasks/failure-identity'
import { getDomainErrorDefinition } from '../../../shared/domain-errors'
import { recoveryDecision, recoveryIsDue } from '../../../shared/error-recovery'
import { getActiveSourceRequestId, lastSourceRecoveryStartedAt, persistSourceRecovery } from './request-store'
import { getDownloadQueueControl } from '../download/queue-control'
import { resolveRecoveryTarget, sourceRecoveryTarget } from '../tasks/recovery-targets'

interface Problem {
  failure_kind: string
  status: 'open' | 'ignored'
  attempt_count: number
  last_seen_at: string
  song_id: number | null
  subject_key: string
}

export function sourceRecoveryGate(sourceId: string, config: AppConfig, manual: boolean) {
  const control = getDownloadQueueControl()
  if (!manual && control.reason === 'authentication') return { action: 'paused' as const, nextRetryAt: null }
  const rows = getDb().prepare(`SELECT failure_kind, status, attempt_count, last_seen_at FROM failure_records
    WHERE subject_key = ? AND status IN ('open','ignored') ORDER BY status='ignored' DESC, last_seen_at DESC`)
    .all(failureSubjectKey({ sourceId, songName: '来源同步' })) as Problem[]
  for (const row of rows) {
    const decision = recoveryDecision({ errorCode: getDomainErrorDefinition(row.failure_kind).code,
      status: row.status, attemptCount: row.attempt_count, attemptLimit: config.sync.maxFailureAttempts, lastSeenAt: row.last_seen_at })
    if (row.status === 'ignored' || (!manual && !recoveryIsDue(decision))) {
      return decision.action === 'retry' && control.cooldownUntil && control.cooldownUntil > decision.nextRetryAt!
        ? { ...decision, nextRetryAt: control.cooldownUntil } : decision
    }
  }
  if (control.cooldownUntil) return { action: 'retry' as const, nextRetryAt: control.cooldownUntil }
  return null
}

/** Source requests own delayed recovery; historical runs are only diagnostics. */
export function scheduleSourceRecovery(sourceId: string, config: AppConfig): string | null {
  const source = getSource(sourceId)
  if (!source || !sourceRecoveryTarget(sourceId, config, 'automatic').eligible || sourceRecoveryGate(sourceId, config, false)?.action === 'ignored') return null
  const db = getDb()
  const activeRequestId = getActiveSourceRequestId(sourceId)
  if (activeRequestId) return activeRequestId
  const rows = db.prepare(`SELECT failure_kind, status, attempt_count, last_seen_at, song_id, subject_key FROM failure_records current
    WHERE source_id=? AND status='open'
      AND (song_id IS NULL OR EXISTS (SELECT 1 FROM playlist_source_track_occurrences member
        WHERE member.source_id=current.source_id AND member.netease_song_id=current.song_id AND member.membership_status='current'))
      AND NOT EXISTS (
      SELECT 1 FROM failure_records newer WHERE newer.subject_key=current.subject_key
        AND newer.status IN ('open','ignored') AND (newer.status='ignored' OR newer.last_seen_at>current.last_seen_at
          OR (newer.last_seen_at=current.last_seen_at AND newer.rowid>current.rowid))
    )`).all(sourceId) as Problem[]
  const lastRecovery = lastSourceRecoveryStartedAt(sourceId)
  const retries = rows.flatMap(row => {
    const removal = plexRemovalTarget(row.subject_key)
    if (!resolveRecoveryTarget({ sourceId, songId: row.song_id, ...removal }, config, 'automatic').eligible) return []
    const decision = recoveryDecision({ errorCode: getDomainErrorDefinition(row.failure_kind).code,
      status: row.status, attemptCount: row.attempt_count, attemptLimit: config.sync.maxFailureAttempts, lastSeenAt: row.last_seen_at })
    // A completed recovery already examined this due attempt. Without a new
    // failure, leave further observation to normal sync or an explicit retry.
    if (lastRecovery && decision.nextRetryAt && decision.nextRetryAt <= lastRecovery) return []
    return decision.action === 'retry' ? [{ ...row, at: decision.nextRetryAt! }] : []
  })
  const next = retries.map(row => row.at).sort()[0]
  if (!next) return null
  const gate = sourceRecoveryGate(sourceId, config, false)
  if (gate && gate.action !== 'retry') return null
  const availableAt = gate?.nextRetryAt && gate.nextRetryAt > next ? gate.nextRetryAt : next
  return persistSourceRecovery(sourceId, availableAt)
}

export function recoverSourceAfterEnvironmentRepair(sourceId: string, config: AppConfig): string | null {
  if (!sourceRecoveryTarget(sourceId, config, 'environment').eligible) return null
  return persistSourceRecovery(sourceId, new Date().toISOString(), true)
}
