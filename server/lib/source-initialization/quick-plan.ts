import { randomUUID } from 'node:crypto'
import { getDb } from '../db'
import { getInitializationIdentityBindings } from '../sync/identity-store'
import { getInitializationApplyRequest } from '../sync/request-store'
import { requestInitializationApply } from './requests'
import { buildInitializationPlan, type InitializationPlan, type PlanOptions } from './plan-builder'
import { matchingFingerprint } from './matching-snapshot'
import { assertAwaitingReview, getInitialization, getLatestInitialization, refreshDecisionCounts } from './store'
import { InitializationConflictError } from './errors'
import type { QuickPreview } from '../../../shared/quick-initialization'

type Row = Record<string, unknown>
type StoredPlan = InitializationPlan
const rowsFor = (id:string) => getDb().prepare(`SELECT netease_song_id,title,tier,evidence_json,candidates_json,${mutableColumns.join(',')}
  FROM source_initialization_items WHERE initialization_id=? ORDER BY position`).all(id) as Row[]
function bindingsSnapshot(rows:Row[]) {
  return [...getInitializationIdentityBindings(rows.map(r=>Number(r.netease_song_id))).values()].map(b=>({songId:b.neteaseSongId,version:b.updatedAt,path:b.plexFilePath,key:b.plexRatingKey,status:b.status,section:b.plexSectionKey})).sort((a,b)=>a.songId-b.songId)
}
function current(sourceId:string,id:string) {
  const init=getInitialization(id)
  if (!init || init.sourceId!==sourceId || getLatestInitialization(sourceId)?.id!==id) throw new InitializationConflictError('接管草案已变化，请刷新')
  return init
}
function preparePlan(sourceId:string,initializationId:string,revision:number,threshold:number,options:PlanOptions={}) {
  const init=current(sourceId,initializationId);assertAwaitingReview(initializationId)
  if(init.revision!==revision)throw new InitializationConflictError('草案已编辑，请重新预览')
  if(!Number.isInteger(threshold)||threshold<0||threshold>100)throw new Error('分数线必须是 0–100 整数')
  if(init.scoreVersion!==1)throw new InitializationConflictError('当前草案未评分，请重新分析')
  const rows=rowsFor(initializationId),bindings=bindingsSnapshot(rows)
  return {init,rows,bindings,plan:buildInitializationPlan(rows,bindings,threshold,options)}
}
export function previewQuickPlan(sourceId:string,initializationId:string,revision:number,threshold:number):QuickPreview {
  return getDb().transaction(()=>{
    const {init,bindings,plan}=preparePlan(sourceId,initializationId,revision,threshold)
    const id=randomUUID(),token=randomUUID(),created=new Date().toISOString(),expires=new Date(Date.now()+20*60_000).toISOString()
    getDb().prepare("DELETE FROM initialization_quick_operations WHERE status='preview' AND expires_at<?").run(created)
    getDb().prepare('INSERT INTO initialization_quick_operations(id,token,initialization_id,revision,threshold,fingerprint,bindings_json,plan_json,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(id,token,initializationId,revision,threshold,matchingFingerprint([init.matchingDataFingerprint,init.matchingConfigFingerprint,init.scoreVersion]),JSON.stringify(bindings),JSON.stringify(plan),created,expires)
    return readQuickPreview(sourceId,id,token)
  })()
}

const mutableColumns=['candidate_rating_key','candidate_file_path','candidate_title','candidate_artist','candidate_album','candidate_duration_ms','decision','decision_status','updated_at'] as const
const evidenceKeys=['sharedMediaConfirmed','decisionOrigin','quickDecision'] as const
function undoRows(rows:Row[],plan:StoredPlan) {
  const changed=new Set(plan.items.filter(item=>item.decision!=='preserve').map(item=>item.songId))
  return rows.filter(row=>changed.has(Number(row.netease_song_id))).map(row=>{
    const evidence=JSON.parse(String(row.evidence_json))
    return {netease_song_id:row.netease_song_id,...Object.fromEntries(mutableColumns.map(key=>[key,row[key]])),
      evidence:Object.fromEntries(evidenceKeys.filter(key=>key in evidence).map(key=>[key,evidence[key]]))}
  })
}
function writePlan(id:string,rows:Row[],plan:StoredPlan,operationId:string,threshold:number) {
  const before=new Map(rows.map(row=>[Number(row.netease_song_id),row]))
  const update=getDb().prepare("UPDATE source_initialization_items SET candidate_rating_key=?,candidate_file_path=?,candidate_title=?,candidate_artist=?,candidate_album=?,candidate_duration_ms=?,decision=?,decision_status='proposed',evidence_json=?,updated_at=? WHERE initialization_id=? AND netease_song_id=?")
  for(const item of plan.items) {
    if(item.decision==='preserve')continue
    const row=before.get(item.songId)!,evidence=JSON.parse(String(row.evidence_json)),candidate=item.candidate
    delete evidence.sharedMediaConfirmed
    evidence.decisionOrigin=plan.manualSelection?'manual':item.origin
    evidence.quickDecision={operationId,origin:item.origin,threshold,score:item.score,scoreVersion:1,sharedIds:item.sharedIds}
    update.run(candidate?.ratingKey??null,candidate?.filePath??null,candidate?.title??'',candidate?.artist??'',candidate?.album??'',candidate?.durationMs??null,item.decision,JSON.stringify(evidence),new Date().toISOString(),id,item.songId)
  }
  refreshDecisionCounts(id)
  getDb().prepare('UPDATE source_initializations SET quick_operation_id=? WHERE id=?').run(operationId,id)
}

/** Automatic arrangements need authorization evidence, without a preview token lifecycle or undo copy. */
export function saveAutomaticPlan(sourceId:string,initializationId:string,options:PlanOptions) {
  return getDb().transaction(()=>{
    const revision=getInitialization(initializationId)!.revision!
    const {rows,bindings,plan}=preparePlan(sourceId,initializationId,revision,0,options)
    const id=randomUUID(),created=new Date().toISOString()
    const authorizedIds=new Set(plan.items.filter(item=>item.decision==='adopt').flatMap(item=>item.sharedIds))
    getDb().prepare(`INSERT INTO initialization_quick_operations(id,token,initialization_id,revision,threshold,fingerprint,bindings_json,plan_json,status,created_at,expires_at)
      VALUES (?,?,?,?,0,'',?,?,'saved',?,?)`).run(id,randomUUID(),initializationId,revision,JSON.stringify(bindings.filter(binding=>authorizedIds.has(binding.songId))),JSON.stringify({automatic:true}),created,created)
    writePlan(initializationId,rows,plan,id,0)
    getDb().prepare('UPDATE initialization_quick_operations SET applied_revision=? WHERE id=?').run(getInitialization(initializationId)!.revision,id)
    return {operationId:id,counts:plan.counts}
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
    const previousState=db.prepare('SELECT quick_threshold,quick_operation_id FROM source_initializations WHERE id=?').get(id) as Row
    const previous=start?null:JSON.stringify({rows:undoRows(rows,plan),...previousState})
    db.prepare('UPDATE initialization_quick_operations SET previous_json=? WHERE id=?').run(previous,operationId)
    writePlan(id,rows,plan,operationId,Number(op.threshold))
    db.prepare('UPDATE source_initializations SET quick_threshold=? WHERE id=?').run(op.threshold,id)
    db.prepare("UPDATE initialization_quick_operations SET status='saved',applied_revision=? WHERE id=?").run(getInitialization(id)!.revision,operationId)
    const requestId=start?requestInitializationApply(sourceId,id).requestId:null
    if(start)db.prepare("UPDATE initialization_quick_operations SET status='queued',request_id=? WHERE id=?").run(requestId,operationId)
    return {operationId,requestId,status:start?'queued':'saved'}
  })()
}
export function restoreQuickPlan(sourceId:string,operationId:string,token:string) {
  const db=getDb();return db.transaction(()=>{
    const op=getOperation(sourceId,operationId,token),id=String(op.initialization_id),init=current(sourceId,id);assertAwaitingReview(id)
    if(op.status!=='saved'||init.revision!==op.applied_revision||!op.previous_json)throw new InitializationConflictError('只能恢复尚未执行且未再次编辑的草案')
    const previous=JSON.parse(String(op.previous_json)) as {rows:Row[];quick_threshold:number|null;quick_operation_id:string|null}
    const update=db.prepare(`UPDATE source_initialization_items SET ${mutableColumns.map(key=>`${key}=?`).join(',')},evidence_json=? WHERE initialization_id=? AND netease_song_id=?`)
    for(const row of previous.rows) {
      // Current drafts store only changed fields. Existing full-row undo snapshots remain readable until restored or compacted.
      const evidence=JSON.parse(String(row.evidence_json??(db.prepare('SELECT evidence_json FROM source_initialization_items WHERE initialization_id=? AND netease_song_id=?').get(id,row.netease_song_id) as Row).evidence_json))
      const prior=row.evidence as Record<string,unknown>|undefined
      if(prior) {
        for(const key of evidenceKeys)delete evidence[key]
        for(const key of evidenceKeys)if(key in prior) evidence[key]=prior[key]
      }
      update.run(...mutableColumns.map(key=>row[key]),JSON.stringify(evidence),id,row.netease_song_id)
    }
    refreshDecisionCounts(id)
    db.prepare("UPDATE initialization_quick_operations SET status='restored' WHERE id=?").run(operationId)
    const previousId=previous.quick_operation_id
    db.prepare('UPDATE source_initializations SET quick_operation_id=?,quick_threshold=? WHERE id=?').run(previousId,previous.quick_threshold,id)
    if(previousId)db.prepare("UPDATE initialization_quick_operations SET applied_revision=? WHERE id=? AND status='saved'").run(getInitialization(id)!.revision,previousId)
    return {restored:true}
  })()
}

export function cancelQuickPlan(sourceId:string,initializationId:string) {
  return getDb().transaction(()=>{
    const init=current(sourceId,initializationId)
    if(init.status==='completed')throw new InitializationConflictError('方案已经应用，不能撤销外部操作')
    const request=getInitializationApplyRequest(initializationId)
    if(!request||!['pending','running'].includes(request.status))throw new InitializationConflictError('当前没有排队的歌曲安排')
    const now=new Date().toISOString()
    getDb().prepare('UPDATE source_sync_queue SET cancel_requested_at=? WHERE id=?').run(now,request.id)
    if(request.status==='pending'){
      getDb().prepare("UPDATE source_sync_queue SET status='cancelled',finished_at=?,updated_at=? WHERE id=?").run(now,now,request.id)
      getDb().prepare("UPDATE initialization_quick_operations SET status='cancelled',previous_json=NULL WHERE request_id=?").run(request.id)
    }
    return {cancelRequested:true}
  })()
}
