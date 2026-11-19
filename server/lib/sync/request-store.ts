import { randomUUID } from 'node:crypto'
import { getDb } from '../db'
import type { TaskRunTrigger } from '../job/types'
import type { PlexRecoverySnapshot, SyncMode } from './service-state'

export type SourceRequestKind = 'analysis' | 'convergence' | 'initialization_apply' | 'plex_recovery'
export const SOURCE_RECOVERY_REQUEST_SQL = "COALESCE(follow_up_of,'') LIKE 'recovery:%'"

export interface SourceRequestInput {
  sourceId: string
  kind: SourceRequestKind
  plexRecoverySnapshot?: PlexRecoverySnapshot
  retrySongIds?: number[]
  trigger: TaskRunTrigger
  mode?: SyncMode
  batchId?: string
  position?: number
  initializationId?: string
  followUpOf?: string
  allowDisabled?: boolean
  takeOverExternal?: boolean
  runId?: string
  scheduleWindow?: string
  now?: Date
  availableAt?: string
}

export function persistSourceRequest(input: SourceRequestInput): string {
  const db = getDb()
  const key = input.kind === 'analysis' && input.initializationId ? 'initialization_id' : input.followUpOf ? 'follow_up_of' : null
  if (key) {
    const existing = db.prepare(`SELECT id FROM source_sync_queue WHERE ${key}=?${key === 'initialization_id' ? " AND request_kind='analysis'" : ''}`).get(key === 'initialization_id' ? input.initializationId : input.followUpOf) as { id: string } | undefined
    if (existing) return existing.id
  }
  const id = randomUUID()
  const now = (input.now ?? new Date()).toISOString()
  const previousWindow = input.scheduleWindow
    ? db.prepare('SELECT id,status FROM source_sync_queue WHERE source_id=? AND schedule_window=?')
      .get(input.sourceId, input.scheduleWindow) as { id: string; status: string } | undefined
    : undefined
  if (previousWindow && ['pending', 'running'].includes(previousWindow.status)) return previousWindow.id
  // A cancelled/finished attempt is history, not an executable schedule window.
  const scheduleWindow = input.scheduleWindow
    ? `${input.scheduleWindow}${previousWindow ? `:${id}` : ''}`
    : `${input.trigger === 'schedule' ? 'schedule' : 'manual'}:${now}:${id}`
  db.prepare(`INSERT INTO source_sync_queue (
    id,source_id,schedule_window,status,available_at,attempts,created_at,updated_at,
    request_kind,mode,trigger,batch_id,batch_position,initialization_id,follow_up_of,allow_disabled,take_over_external,run_id,plex_recovery_json,retry_song_ids_json
  ) VALUES (?,?,?,'pending',?,0,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id,input.sourceId,scheduleWindow,input.availableAt ?? now,now,now,
    input.kind,input.mode ?? 'normal',input.trigger,input.batchId ?? null,input.position ?? 0,
    input.initializationId ?? null,input.followUpOf ?? null,Number(input.allowDisabled ?? false),Number(input.takeOverExternal ?? false),input.runId ?? null,
    input.plexRecoverySnapshot ? JSON.stringify(input.plexRecoverySnapshot) : null,
    input.retrySongIds ? JSON.stringify(input.retrySongIds) : null,
  )
  db.prepare("UPDATE playlist_sources SET last_schedule_status='queued', last_scheduled_at=?, last_schedule_error=NULL WHERE id=?").run(now, input.sourceId)
  return id
}

export function getInitializationRequest(initializationId: string) {
  return getDb().prepare("SELECT id, status, run_id AS runId FROM source_sync_queue WHERE initialization_id=? AND request_kind='analysis'")
    .get(initializationId) as { id: string; status: string; runId: string | null } | undefined
}

export function getInitializationApplyRequest(initializationId: string) {
  return getDb().prepare(`SELECT id,status,last_error FROM source_sync_queue
    WHERE initialization_id=? AND request_kind='initialization_apply' ORDER BY created_at DESC,rowid DESC LIMIT 1`)
    .get(initializationId) as { id: string; status: string; last_error: string | null } | undefined
}

export function sourceRequestsBusy(): boolean {
  return Boolean(getDb().prepare("SELECT 1 FROM source_sync_queue WHERE status='running' OR (status='pending' AND available_at<=?) LIMIT 1").get(new Date().toISOString()))
}

export function getActiveSourceRequestId(sourceId: string): string | null {
  return (getDb().prepare("SELECT id FROM source_sync_queue WHERE source_id=? AND status IN ('pending','running') LIMIT 1")
    .get(sourceId) as { id: string } | undefined)?.id ?? null
}

export function cancelPendingSourceRecoveries(sourceId: string, exceptId?: string): void {
  const now = new Date().toISOString()
  getDb().prepare(`UPDATE source_sync_queue SET status='cancelled',finished_at=?,updated_at=?
    WHERE source_id=? AND status='pending' AND id<>? AND ${SOURCE_RECOVERY_REQUEST_SQL}`)
    .run(now, now, sourceId, exceptId ?? '')
}

export function lastSourceRecoveryStartedAt(sourceId: string): string | null {
  return (getDb().prepare(`SELECT MAX(started_at) AS started_at FROM source_sync_queue
    WHERE source_id=? AND ${SOURCE_RECOVERY_REQUEST_SQL} AND status IN ('completed','failed')`)
    .get(sourceId) as { started_at: string | null }).started_at
}

/** The source queue owns recovery deduplication, replacement and durable markers. */
export function persistSourceRecovery(sourceId: string, availableAt: string, environmentRestored = false): string {
  return getDb().transaction(() => {
    if (environmentRestored) cancelPendingSourceRecoveries(sourceId)
    return getActiveSourceRequestId(sourceId) ?? persistSourceRequest({ sourceId, availableAt,
      kind: 'convergence', trigger: 'system', mode: 'full',
      followUpOf: `recovery:${environmentRestored ? 'environment:' : ''}${sourceId}:${randomUUID()}` })
  })()
}
