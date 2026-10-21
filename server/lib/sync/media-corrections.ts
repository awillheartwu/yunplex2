import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import { mapLocalPathToPlex } from './path-map'
import { getDb, readConfigFromDb } from '../db'
import { getSource } from '../playlist/store'
import { persistSourceRequest } from './request-store'
import { markSongSourcesPendingAlignment } from './match-management-store'
import { BindingVersionConflictError, getSongIdentityBinding, upsertVerifiedSongIdentityBinding, type BindingInput } from './identity-store'
import { getLocalMediaAsset, upsertLocalMediaAsset, type LocalMediaAsset } from './local-media-store'
import type { CompletedMediaWrite } from '../download/media-write'
export interface MediaCorrection {id:string;song_id:number;expected_version:string|null;old_binding_json:string;old_asset_json:string;staged_asset_json:string|null;status:string}
export function getMediaCorrection(songId:number):MediaCorrection|null {
  return getDb().prepare("SELECT * FROM media_corrections WHERE song_id=? AND status IN ('pending','ready') ORDER BY created_at DESC LIMIT 1").get(songId) as MediaCorrection??null
}

/** Only actionable corrections keep requesting reconciliation. */
export function hasActiveMediaCorrectionsForSource(sourceId: string): boolean {
  const row = getDb().prepare(`
    SELECT 1
    FROM media_corrections correction
    JOIN playlist_source_track_occurrences occurrence
      ON occurrence.netease_song_id = correction.song_id
      AND occurrence.source_id = ?
      AND occurrence.membership_status = 'current'
    WHERE correction.status IN ('pending', 'ready')
      AND NOT EXISTS (
        SELECT 1 FROM source_media_decisions decision
        WHERE decision.source_id = occurrence.source_id
          AND decision.netease_song_id = correction.song_id
          AND decision.disposition = 'defer' AND decision.resolved_at IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM failure_records failure
        WHERE failure.source_id = occurrence.source_id AND failure.song_id = correction.song_id
          AND failure.status = 'ignored'
          AND failure.last_seen_at >= correction.updated_at
      )
    LIMIT 1
  `).get(sourceId)
  return Boolean(row)
}
export function queueIdentityRealignment(songId:number,changeId:string) {
  const affected=markSongSourcesPendingAlignment(songId)
  const requests=affected.filter(source=>getSource(source.id)?.enabled).map(source=>persistSourceRequest({sourceId:source.id,kind:'convergence',trigger:'user',followUpOf:`identity:${changeId}:${source.id}`}))
  return {affectedSources:affected,requestIds:requests}
}
/** Prepare a protected replacement inside a caller-owned source transaction. */
export function prepareMediaCorrection(songId:number,expectedVersion:string|null):string {
  return getDb().transaction(()=>{
    const binding=getSongIdentityBinding(songId)
    if((binding?.updatedAt??null)!==expectedVersion)throw new BindingVersionConflictError()
    const existing=getMediaCorrection(songId)
    if(existing){
      if(existing.expected_version!==expectedVersion)throw new BindingVersionConflictError()
      getDb().prepare('UPDATE media_corrections SET updated_at=? WHERE id=?').run(new Date().toISOString(),existing.id)
      markSongSourcesPendingAlignment(songId)
      return existing.id
    }
    const id=randomUUID(),now=new Date().toISOString()
    getDb().prepare("INSERT INTO media_corrections(id,song_id,expected_version,old_binding_json,old_asset_json,status,created_at,updated_at) VALUES (?,?,?,?,?,'pending',?,?)").run(id,songId,expectedVersion,JSON.stringify(binding),JSON.stringify(getLocalMediaAsset(songId)),now,now)
    markSongSourcesPendingAlignment(songId)
    return id
  })()
}
export function requestMediaCorrection(songId:number,expectedVersion:string|null) {
  return getDb().transaction(()=>{
    const id=prepareMediaCorrection(songId,expectedVersion)
    return {correctionId:id,...queueIdentityRealignment(songId,id)}
  })()
}
/** Check under the identity mutation lock before publishing any replacement. */
export function assertMediaCorrectionCurrent(songId:number,taskId?:string|null):MediaCorrection|null {
  const correction=getMediaCorrection(songId)
  const task=taskId?getDb().prepare('SELECT idempotency_key FROM download_tasks WHERE id=?').get(taskId) as {idempotency_key:string|null}|undefined:undefined
  const expectedCorrection=task?.idempotency_key?.split(':correction:')[1]
  if(expectedCorrection && correction?.id!==expectedCorrection)throw new BindingVersionConflictError()
  if(!correction)return null
  if(taskId&&!expectedCorrection)throw new Error('当前有媒体纠错正在处理，请完成后重试其他文件操作')
  if((getSongIdentityBinding(songId)?.updatedAt??null)!==correction.expected_version)throw new BindingVersionConflictError()
  return correction
}
/** File completed, but old asset and binding remain authoritative until exact Plex validation. */
export function stageCorrectionMedia(input:CompletedMediaWrite):LocalMediaAsset|null {
  const correction=assertMediaCorrectionCurrent(input.neteaseSongId,input.taskId)
  if(!correction)return null
  const stat=statSync(input.filePath),now=new Date().toISOString()
  const asset:LocalMediaAsset={neteaseSongId:input.neteaseSongId,filePath:input.filePath,provenance:input.provenance,ownership:'managed',sourceTaskId:input.taskId??null,status:'active',fileSize:stat.size,fileMtimeMs:stat.mtimeMs,evidence:{correctionId:correction.id},createdAt:now,updatedAt:now,lastVerifiedAt:now}
  getDb().prepare("UPDATE media_corrections SET staged_asset_json=?,status='ready',updated_at=? WHERE id=?").run(JSON.stringify(asset),now,correction.id)
  return asset
}
export function finalizeCorrectionBinding(binding:BindingInput):boolean {
  const correction=getMediaCorrection(binding.neteaseSongId)
  if(!correction)return false
  if((getSongIdentityBinding(binding.neteaseSongId)?.updatedAt??null)!==correction.expected_version)throw new BindingVersionConflictError()
  if(!correction.staged_asset_json)throw new Error('托管副本尚未完成验证')
  const asset=JSON.parse(correction.staged_asset_json) as LocalMediaAsset
  if(binding.plexFilePath!==mapLocalPathToPlex(asset.filePath,readConfigFromDb()))throw new Error('纠错媒体路径不一致')
  if(binding.evidence.correctionId!==correction.id)throw new Error('媒体纠错目标不一致')
  getDb().transaction(()=>{
    upsertLocalMediaAsset(asset)
    upsertVerifiedSongIdentityBinding({...binding,evidence:{...binding.evidence,previousBinding:JSON.parse(correction.old_binding_json),correctionId:correction.id}})
    getDb().prepare("UPDATE source_media_decisions SET resolved_at=?,updated_at=? WHERE netease_song_id=? AND disposition='download' AND resolved_at IS NULL").run(new Date().toISOString(),new Date().toISOString(),binding.neteaseSongId)
    getDb().prepare("UPDATE media_corrections SET status='applied',updated_at=? WHERE id=?").run(new Date().toISOString(),correction.id)
  })()
  return true
}
