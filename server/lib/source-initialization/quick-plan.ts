import { randomUUID } from 'node:crypto'
import { getDb } from '../db'
import { getInitializationIdentityBindings } from '../sync/identity-store'
import { persistSourceRequest } from '../sync/request-store'
import { matchingFingerprint } from './matching-snapshot'
import { assertAwaitingReview, getInitialization, getLatestInitialization, refreshDecisionCounts } from './store'
import { InitializationConflictError } from './errors'
import type { QuickPlanItem, QuickPreview } from '../../../shared/quick-initialization'
import type { InitializationCandidate } from './types'

type Row = Record<string, unknown>
type StoredPlan = {items:QuickPlanItem[];counts:QuickPreview['counts'];histogram:number[]}
const rowsFor = (id:string) => getDb().prepare('SELECT * FROM source_initialization_items WHERE initialization_id=? ORDER BY position').all(id) as Row[]
function bindingsSnapshot(rows:Row[]) {
  return [...getInitializationIdentityBindings(rows.map(r=>Number(r.netease_song_id))).values()].map(b=>({songId:b.neteaseSongId,version:b.updatedAt,path:b.plexFilePath,key:b.plexRatingKey,status:b.status,section:b.plexSectionKey})).sort((a,b)=>a.songId-b.songId)
}
function current(sourceId:string,id:string) {
  const init=getInitialization(id)
  if (!init || init.sourceId!==sourceId || getLatestInitialization(sourceId)?.id!==id) throw new InitializationConflictError('接管草案已变化，请刷新')
  return init
}
export function previewQuickPlan(sourceId:string,initializationId:string,revision:number,threshold:number):QuickPreview {
  const db=getDb()
  return db.transaction(()=>{
    const init=current(sourceId,initializationId); assertAwaitingReview(initializationId)
    if (init.revision!==revision) throw new InitializationConflictError('草案已编辑，请重新预览')
    if (!Number.isInteger(threshold)||threshold<0||threshold>100) throw new Error('分数线必须是 0–100 整数')
    if (init.scoreVersion!==1) throw new InitializationConflictError('当前草案未评分，请重新分析')
    const rows=rowsFor(initializationId),bindings=bindingsSnapshot(rows),histogram=Array<number>(10).fill(0)
    const items:QuickPlanItem[]=rows.map(row=>{
      const evidence=JSON.parse(String(row.evidence_json))
      const scored=(evidence.scoredCandidates??[]) as Array<{candidate:InitializationCandidate;score:{total:number;eligible:boolean;risks:string[]}}>
      const best=scored.find(value=>value.score.eligible)
      if (best) histogram[Math.min(9,Math.floor(best.score.total/10))]!++
      const preserve=row.tier==='preserved'
      const adopt=!preserve && !!best && best.score.total>=threshold
      return {songId:Number(row.netease_song_id),title:String(row.title),decision:preserve?'preserve':adopt?'adopt':'download',
        origin:preserve?'preserved':adopt?(row.tier==='strong_id'||row.tier==='high_confidence'?'rule_recommended':'threshold_match'):'threshold_download',
        candidate:adopt?best!.candidate:null,score:best?.score.total??null,risks:best?.score.risks??['没有可用候选'],sharedIds:[]}
    })
    for(const item of items.filter(item=>item.decision==='adopt')) {
      const peers=items.filter(other=>other.decision==='adopt'&&(other.candidate?.ratingKey===item.candidate!.ratingKey||other.candidate?.filePath===item.candidate!.filePath)).map(other=>other.songId)
      const owners=bindings.filter(b=>b.status==='active'&&(b.key===item.candidate!.ratingKey||b.path===item.candidate!.filePath)).map(b=>b.songId)
      item.sharedIds=[...new Set([...peers,...owners])].sort((a,b)=>a-b)
      if(item.sharedIds.length>1)item.risks.push(`与歌曲 ID ${item.sharedIds.filter(id=>id!==item.songId).join('、')} 共用媒体`)
    }
    const counts={preserved:items.filter(i=>i.decision==='preserve').length,matched:items.filter(i=>i.decision==='adopt').length,downloads:items.filter(i=>i.decision==='download').length,shared:new Set(items.filter(i=>i.sharedIds.length>1).map(i=>`${i.candidate?.ratingKey}:${i.candidate?.filePath}`)).size,overwritten:items.filter(i=>i.decision!=='preserve').length}
    const id=randomUUID(),token=randomUUID(),created=new Date().toISOString(),expires=new Date(Date.now()+20*60_000).toISOString()
    db.prepare("DELETE FROM initialization_quick_operations WHERE status='preview' AND expires_at<?").run(created)
    db.prepare('INSERT INTO initialization_quick_operations(id,token,initialization_id,revision,threshold,fingerprint,bindings_json,plan_json,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(id,token,initializationId,revision,threshold,matchingFingerprint([init.matchingDataFingerprint,init.matchingConfigFingerprint,init.scoreVersion]),JSON.stringify(bindings),JSON.stringify({items,counts,histogram}),created,expires)
    return readQuickPreview(sourceId,id,token)
  })()
}
export function readQuickPreview(sourceId:string,operationId:string,token:string,page=1):QuickPreview {
  const op=getOperation(sourceId,operationId,token),plan=JSON.parse(String(op.plan_json)) as StoredPlan
  const size=50,p=Math.max(1,Math.min(Math.ceil(plan.items.length/size)||1,Math.trunc(page)||1))
  return {operationId,token,initializationId:String(op.initialization_id),revision:Number(op.revision),threshold:Number(op.threshold),expiresAt:String(op.expires_at),counts:plan.counts,histogram:plan.histogram,items:plan.items.slice((p-1)*size,p*size),total:plan.items.length,page:p,pageSize:size}
}
function getOperation(sourceId:string,id:string,token:string):Row {
  const op=getDb().prepare('SELECT * FROM initialization_quick_operations WHERE id=? AND token=?').get(id,token) as Row|undefined
  if(!op)throw new InitializationConflictError('快速预览不存在')
  const init=getInitialization(String(op.initialization_id))
  if(init?.sourceId!==sourceId)throw new InitializationConflictError('快速预览不属于当前来源')
  return op
}
export function confirmQuickPlan(sourceId:string,operationId:string,token:string,start:boolean) {
  const db=getDb()
  return db.transaction(()=>{
    const op=getOperation(sourceId,operationId,token)
    if(['queued','saved','executed'].includes(String(op.status)))return {operationId,requestId:op.request_id,status:op.status}
    const id=String(op.initialization_id),init=current(sourceId,id);assertAwaitingReview(id)
    if(op.status!=='preview'||String(op.expires_at)<=new Date().toISOString()||init.revision!==op.revision)throw new InitializationConflictError('预览过期或草案已改变，请重新预览')
    if(matchingFingerprint([init.matchingDataFingerprint,init.matchingConfigFingerprint,init.scoreVersion])!==op.fingerprint)throw new InitializationConflictError('评分快照已变化')
    const rows=rowsFor(id),bindings=bindingsSnapshot(rows)
    if(JSON.stringify(bindings)!==op.bindings_json)throw new InitializationConflictError('媒体身份已变化，请重新预览')
    const plan=JSON.parse(String(op.plan_json)) as StoredPlan
    const before=new Map(rows.map(row=>[Number(row.netease_song_id),row]))
    const previousState=db.prepare('SELECT quick_threshold,quick_operation_id FROM source_initializations WHERE id=?').get(id) as Row
    db.prepare('UPDATE initialization_quick_operations SET previous_json=? WHERE id=?').run(JSON.stringify({rows,...previousState}),operationId)
    for(const item of plan.items) {
      if(item.decision==='preserve')continue
      const row=before.get(item.songId)!,evidence=JSON.parse(String(row.evidence_json)),candidate=item.candidate
      delete evidence.sharedMedia;delete evidence.sharedMediaConfirmed
      evidence.decisionOrigin=item.origin
      evidence.quickDecision={operationId,origin:item.origin,threshold:Number(op.threshold),score:item.score,scoreVersion:1,sharedIds:item.sharedIds}
      db.prepare("UPDATE source_initialization_items SET candidate_rating_key=?,candidate_file_path=?,candidate_title=?,candidate_artist=?,candidate_album=?,candidate_duration_ms=?,decision=?,decision_status='proposed',evidence_json=?,updated_at=? WHERE initialization_id=? AND netease_song_id=?")
        .run(candidate?.ratingKey??null,candidate?.filePath??null,candidate?.title??'',candidate?.artist??'',candidate?.album??'',candidate?.durationMs??null,item.decision,JSON.stringify(evidence),new Date().toISOString(),id,item.songId)
    }
    refreshDecisionCounts(id)
    const requestId=start?persistSourceRequest({sourceId,kind:'initialization_apply',trigger:'user',followUpOf:`quick:${operationId}`,allowDisabled:true,runId:init.runId??undefined}):null
    db.prepare('UPDATE source_initializations SET quick_threshold=?,quick_operation_id=? WHERE id=?').run(op.threshold,operationId,id)
    db.prepare('UPDATE initialization_quick_operations SET status=?,request_id=?,applied_revision=? WHERE id=?').run(start?'queued':'saved',requestId,getInitialization(id)!.revision,operationId)
    return {operationId,requestId,status:start?'queued':'saved'}
  })()
}
export function restoreQuickPlan(sourceId:string,operationId:string,token:string) {
  const db=getDb();return db.transaction(()=>{
    const op=getOperation(sourceId,operationId,token),id=String(op.initialization_id),init=current(sourceId,id);assertAwaitingReview(id)
    if(op.status!=='saved'||init.revision!==op.applied_revision||!op.previous_json)throw new InitializationConflictError('只能恢复尚未执行且未再次编辑的草案')
    const previous=JSON.parse(String(op.previous_json)) as Row[]|{rows:Row[];quick_threshold:number|null;quick_operation_id:string|null}
    const rows=Array.isArray(previous)?previous:previous.rows
    for(const row of rows){const entries=Object.entries(row).filter(([key])=>!['initialization_id','netease_song_id'].includes(key));db.prepare(`UPDATE source_initialization_items SET ${entries.map(([key])=>`${key}=?`).join(',')} WHERE initialization_id=? AND netease_song_id=?`).run(...entries.map(([,value])=>value),id,row.netease_song_id)}
    refreshDecisionCounts(id)
    db.prepare("UPDATE initialization_quick_operations SET status='restored' WHERE id=?").run(operationId)
    const previousId=Array.isArray(previous)?null:previous.quick_operation_id
    db.prepare('UPDATE source_initializations SET quick_operation_id=?,quick_threshold=? WHERE id=?').run(previousId,Array.isArray(previous)?null:previous.quick_threshold,id)
    if(previousId)db.prepare("UPDATE initialization_quick_operations SET applied_revision=? WHERE id=? AND status='saved'").run(getInitialization(id)!.revision,previousId)
    return {restored:true}
  })()
}

export function cancelQuickPlan(sourceId:string,initializationId:string) {
  return getDb().transaction(()=>{
    const init=current(sourceId,initializationId)
    if(init.status==='completed')throw new InitializationConflictError('方案已经应用，不能撤销外部操作')
    const op=getDb().prepare("SELECT id,request_id FROM initialization_quick_operations WHERE initialization_id=? AND status='queued'").get(initializationId) as {id:string;request_id:string}|undefined
    if(!op)throw new InitializationConflictError('当前没有排队的快速方案')
    const now=new Date().toISOString()
    const request=getDb().prepare('SELECT status FROM source_sync_queue WHERE id=?').get(op.request_id) as {status:string}|undefined
    if(!request||!['pending','running'].includes(request.status))throw new InitializationConflictError('请求状态已变化，请刷新')
    getDb().prepare('UPDATE source_sync_queue SET cancel_requested_at=? WHERE id=?').run(now,op.request_id)
    if(request.status==='pending'){
      getDb().prepare("UPDATE source_sync_queue SET status='cancelled',finished_at=?,updated_at=? WHERE id=?").run(now,now,op.request_id)
      getDb().prepare("UPDATE initialization_quick_operations SET status='cancelled' WHERE id=?").run(op.id)
    }
    return {cancelRequested:true}
  })()
}
