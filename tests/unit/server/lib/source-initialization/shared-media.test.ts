import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDb, initDb, closeDb } from '~~/server/lib/db'
import { ensurePendingInitialization, replaceInitializationPlans, setInitializationStatus, queryInitializationItems, setInitializationDecisions } from '~~/server/lib/source-initialization/store'
import { confirmSharedMedia, sharedMediaPermissions } from '~~/server/lib/source-initialization/shared-media'
import { buildInitializationPlans } from '~~/server/lib/source-initialization/candidate-engine'
import { matchingPreset } from '~~/shared/initialization-matching'
import { rebindSongIdentity, getSongIdentityBinding, getSongIdentityBindingByRatingKey, unbindSongIdentityWithMode } from '~~/server/lib/sync/identity-store'
let dir = ''
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'shared-media-')); initDb(dir); getDb().prepare("INSERT INTO playlist_sources(id,netease_playlist_id,name,created_at,updated_at) VALUES ('source',1,'test','now','now')").run() })
afterEach(() => { closeDb(); rmSync(dir, {recursive: true, force: true}) })
function draft() {
  const song = { id: 1, name: 'Song', no: 1, dt: 180000, disc: '1', artists: [{name: 'Artist'}], album: {id: 1, name: 'Album', picUrl: '', publishTime: 0} }
  const track = { ratingKey: 'shared', title: 'Song', grandparentTitle: 'Artist', parentTitle: 'Album', index: 1, duration: 180000, Media: [{Part: [{file: '/music/shared.flac'}]}] }
  const plans = buildInitializationPlans({ songs: [song, {...song,id: 2}], tracks: [track], bindings: new Map(), matching: matchingPreset('balanced') })
  const init = ensurePendingInitialization('source'); replaceInitializationPlans(init.id,plans); setInitializationStatus(init.id,'awaiting_review')
  const item = queryInitializationItems({initializationId: init.id}).items[0]!
  return { id: init.id, fingerprint: String(item.evidence.sharedMediaFingerprint) }
}
it('requires explicit group confirmation, persists it and revokes eligibility when one decision changes', () => {
  const {id,fingerprint} = draft()
  expect(sharedMediaPermissions(id).size).toBe(0)
  expect(() => confirmSharedMedia(id,1,'stale')).toThrow('已变化')
  confirmSharedMedia(id,1,fingerprint)
  expect(sharedMediaPermissions(id).get(1)).toEqual([1,2])
  expect(queryInitializationItems({initializationId:id}).items.every(item=>item.decision==='adopt')).toBe(true)
  expect(getSongIdentityBinding(1)).toBeNull()
  setInitializationDecisions({initializationId:id,songIds:[2],decision:'defer'})
  expect(sharedMediaPermissions(id).size).toBe(0)
})
it('allows only the approved exact media peers and leaves the remaining identity when one is unbound', () => {
  const {id,fingerprint} = draft(); confirmSharedMedia(id,1,fingerprint)
  const permissions = sharedMediaPermissions(id)
  const binding = {plexSectionKey:'1',plexFilePath:'/music/shared.flac',plexRatingKey:'shared',evidence:{}}
  rebindSongIdentity({neteaseSongId:1,expectedBindingUpdatedAt:null,binding,sharedWithSongIds:permissions.get(1)})
  rebindSongIdentity({neteaseSongId:2,expectedBindingUpdatedAt:null,binding,sharedWithSongIds:permissions.get(2)})
  expect(getSongIdentityBindingByRatingKey('shared')).toBeNull() // reverse lookup must not guess a source identity
  expect(() => rebindSongIdentity({neteaseSongId:3,expectedBindingUpdatedAt:null,binding})).toThrow()
  expect(() => rebindSongIdentity({neteaseSongId:3,expectedBindingUpdatedAt:null,binding:{...binding,plexFilePath:'/music/other.flac'},sharedWithSongIds:[1,2]})).toThrow()
  unbindSongIdentityWithMode({neteaseSongId:1,expectedBindingUpdatedAt:getSongIdentityBinding(1)!.updatedAt,mode:'reevaluate'})
  expect(getSongIdentityBinding(2)?.status).toBe('active')
})
it('rejects stale identity versions after confirmation', () => {
  const {id,fingerprint} = draft(); confirmSharedMedia(id,1,fingerprint)
  rebindSongIdentity({neteaseSongId:2,expectedBindingUpdatedAt:null,binding:{plexSectionKey:'1',plexFilePath:'/other.flac',plexRatingKey:'other',evidence:{}}})
  expect(sharedMediaPermissions(id).size).toBe(0)
  expect(() => confirmSharedMedia(id,1,fingerprint)).toThrow('关联已变化')
})
