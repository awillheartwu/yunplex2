import { randomUUID } from 'node:crypto'
import { getDb } from '../db'
import type { TaskRunTrigger } from '../job/types'
import type { PlexRecoverySnapshot, SyncMode } from './service-state'

export type SourceRequestKind = 'analysis' | 'convergence' | 'initialization_apply' | 'plex_recovery'

export interface SourceRequestInput {
  sourceId: string
  kind: SourceRequestKind
  plexRecoverySnapshot?: PlexRecoverySnapshot
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
  db.prepare(`INSERT INTO source_sync_queue (
    id,source_id,schedule_window,status,available_at,attempts,created_at,updated_at,
    request_kind,mode,trigger,batch_id,batch_position,initialization_id,follow_up_of,allow_disabled,take_over_external,run_id,plex_recovery_json
  ) VALUES (?,?,?,'pending',?,0,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id,input.sourceId,input.scheduleWindow ?? `${input.trigger === 'schedule' ? 'schedule' : 'manual'}:${now}:${id}`,now,now,now,
    input.kind,input.mode ?? 'normal',input.trigger,input.batchId ?? null,input.position ?? 0,
    input.initializationId ?? null,input.followUpOf ?? null,Number(input.allowDisabled ?? false),Number(input.takeOverExternal ?? false),input.runId ?? null,
    input.plexRecoverySnapshot ? JSON.stringify(input.plexRecoverySnapshot) : null,
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
  return Boolean(getDb().prepare("SELECT 1 FROM source_sync_queue WHERE status IN ('pending','running') LIMIT 1").get())
}
