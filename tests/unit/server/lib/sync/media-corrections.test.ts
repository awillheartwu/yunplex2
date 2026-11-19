import {mkdtempSync,rmSync,writeFileSync,existsSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {beforeEach,afterEach,it,expect} from 'vitest'
import {initDb,closeDb,getDb} from '~~/server/lib/db'
import {requestMediaCorrection,queueIdentityRealignment,getMediaCorrection,stageCorrectionMedia,finalizeCorrectionBinding} from '~~/server/lib/sync/media-corrections'
import {getSongIdentityBinding,rebindSongIdentity} from '~~/server/lib/sync/identity-store'
import {getLocalMediaAsset,upsertLocalMediaAsset} from '~~/server/lib/sync/local-media-store'
let dir=''
beforeEach(()=>{dir=mkdtempSync(join(tmpdir(),'media-correction-'));initDb(dir);for(const [id,enabled] of [['on',1],['off',0]] as const){getDb().prepare("INSERT INTO playlist_sources(id,netease_playlist_id,name,enabled,created_at,updated_at) VALUES (?,?,?,?, 'now','now')").run(id,enabled+1,id,enabled);getDb().prepare("INSERT INTO playlist_source_track_occurrences(id,source_id,netease_song_id,occurrence,position,title,first_observed_at,last_observed_at) VALUES (?,?,1,0,0,'Song','now','now')").run(id,id)}})
afterEach(()=>{closeDb();rmSync(dir,{recursive:true,force:true})})
it('queues enabled sources once and marks disabled sources without executing them',()=>{
  queueIdentityRealignment(1,'change');queueIdentityRealignment(1,'change')
  expect(getDb().prepare('SELECT source_id,status FROM source_sync_queue').all()).toEqual([{source_id:'on',status:'pending'}])
  expect(getDb().prepare('SELECT requires_match_reconcile FROM playlist_sources').all()).toEqual([{requires_match_reconcile:1},{requires_match_reconcile:1}])
})
it('stages independent media without replacing old facts and switches only after expected validation',()=>{
  const old=join(dir,'old.flac'),fresh=join(dir,'new.flac');writeFileSync(old,'old');writeFileSync(fresh,'new')
  upsertLocalMediaAsset({neteaseSongId:1,filePath:old,provenance:'manual',ownership:'external',evidence:{}})
  const binding=rebindSongIdentity({neteaseSongId:1,expectedBindingUpdatedAt:null,binding:{plexSectionKey:'1',plexFilePath:old,plexRatingKey:'old',evidence:{}}}).binding
  const result=requestMediaCorrection(1,binding.updatedAt)
  requestMediaCorrection(1,binding.updatedAt)
  stageCorrectionMedia({neteaseSongId:1,filePath:fresh,provenance:'download_task',audioDownloaded:true})
  expect(getSongIdentityBinding(1)?.plexRatingKey).toBe('old');expect(getLocalMediaAsset(1)?.filePath).toBe(old)
  const next={neteaseSongId:1,plexSectionKey:'1',plexFilePath:fresh,plexRatingKey:'new',bindingMethod:'path' as const,status:'active' as const,evidence:{correctionId:result.correctionId}}
  expect(()=>finalizeCorrectionBinding({...next,evidence:{}})).toThrow('不一致')
  expect(finalizeCorrectionBinding(next)).toBe(true)
  expect(getLocalMediaAsset(1)?.filePath).toBe(fresh);expect(getSongIdentityBinding(1)?.plexRatingKey).toBe('new');expect(existsSync(old)).toBe(true);expect(getMediaCorrection(1)).toBeNull()
})
it('rejects stale correction completion and preserves a newer manual decision',()=>{
  const old=rebindSongIdentity({neteaseSongId:1,expectedBindingUpdatedAt:null,binding:{plexSectionKey:'1',plexFilePath:'/old',plexRatingKey:'old',evidence:{}}}).binding
  requestMediaCorrection(1,old.updatedAt)
  rebindSongIdentity({neteaseSongId:1,expectedBindingUpdatedAt:old.updatedAt,binding:{plexSectionKey:'1',plexFilePath:'/other',plexRatingKey:'other',evidence:{}}})
  expect(()=>requestMediaCorrection(1,old.updatedAt)).toThrow('已被其他操作更新')
  expect(()=>stageCorrectionMedia({neteaseSongId:1,filePath:'/missing',provenance:'download_task',audioDownloaded:true})).toThrow('已被其他操作更新')
  expect(getSongIdentityBinding(1)?.plexRatingKey).toBe('other')
})
