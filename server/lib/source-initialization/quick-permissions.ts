import { getDb } from '../db'
import { getSongIdentityBinding, normalizePlexPath } from '../sync/identity-store'
export function quickMediaPermissions(initializationId:string):Map<number,number[]> {
  const db=getDb(),permissions=new Map<number,number[]>()
  // Cancelling or failing execution keeps the chosen draft; resubmission still revalidates its identity snapshot below.
  const operations=db.prepare("SELECT id,bindings_json FROM initialization_quick_operations WHERE initialization_id=? AND status IN ('queued','saved','cancelled','failed')").all(initializationId) as Array<{id:string;bindings_json:string}>
  const snapshots=new Map(operations.map(op=>[op.id,new Map((JSON.parse(op.bindings_json) as Array<{songId:number;version:string}>).map(b=>[b.songId,b.version]))]))
  const rows=db.prepare('SELECT * FROM source_initialization_items WHERE initialization_id=?').all(initializationId) as Array<Record<string,unknown>>
  const byId=new Map(rows.map(r=>[Number(r.netease_song_id),r]))
  for(const row of rows) {
    const decision=JSON.parse(String(row.evidence_json)).quickDecision
    const versions=snapshots.get(decision?.operationId)
    if(!versions||row.decision!=='adopt')continue
    const peers=decision.sharedIds as number[]
    if(!Array.isArray(peers)||!peers.includes(Number(row.netease_song_id)))continue
    const valid=peers.every(id=>{
      const binding=getSongIdentityBinding(id)
      if((binding?.updatedAt??null)!==(versions.get(id)??null))return false
      const peer=byId.get(id)
      if(peer?.tier!=='preserved'&&peer) return peer.decision==='adopt'&&JSON.parse(String(peer.evidence_json)).quickDecision?.operationId===decision.operationId&&peer.candidate_rating_key===row.candidate_rating_key&&normalizePlexPath(String(peer.candidate_file_path))===normalizePlexPath(String(row.candidate_file_path))
      return binding?.status==='active'&&binding.plexRatingKey===row.candidate_rating_key&&normalizePlexPath(binding.plexFilePath)===normalizePlexPath(String(row.candidate_file_path))
    })
    if(valid)permissions.set(Number(row.netease_song_id),peers)
  }
  return permissions
}
