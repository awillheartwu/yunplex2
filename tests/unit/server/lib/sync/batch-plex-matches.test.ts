import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { DEFAULT_INITIALIZATION_MATCHING as matching } from '~~/shared/initialization-matching'
import { closeDb, getDb, initDb } from '~~/server/lib/db'
import type { NeteaseSong } from '~~/server/lib/netease'
import type { PlexTrack } from '~~/server/lib/plex-client'
import { assessBatchPlexCandidate } from '~~/server/lib/sync/batch-plex-matches'
import { getSongIdentityBinding, rebindSongIdentity, upsertSongIdentityBinding } from '~~/server/lib/sync/identity-store'
import { conflictingLookupOwner } from '~~/server/lib/sync/lookup-identity'
import { saveManualPlexBinding } from '~~/server/lib/sync/manual-plex-binding'
import { observePlaylistSourceTracks } from '~~/server/lib/sync/match-management-store'

let dir: string
const song: NeteaseSong = { id: 1, name: 'Studio Song', artists: [{ name: 'Fixture Artist' }], dt: 180000, no: 1, disc: '1',
  album: { id: 1, name: 'Studio Album', picUrl: '', publishTime: 0 } }
const track: PlexTrack = { ratingKey: '11', title: 'Studio Song', grandparentTitle: 'Fixture Artist', parentTitle: 'Studio Album',
  index: 1, duration: 180000, Media: [{ Part: [{ file: '/music/studio-song.flac' }] }] }
const existing = { plexSectionKey: '1', plexFilePath: '/music/studio-song.flac', plexRatingKey: '11', evidence: {} }

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'reyunplex-batch-plex-'))
  initDb(dir)
  getDb().prepare("INSERT INTO playlist_sources(id,netease_playlist_id,name,created_at,updated_at) VALUES ('source',1,'fixture','now','now')").run()
})
afterEach(() => {
  closeDb()
  rmSync(dir, { recursive: true, force: true })
})

function observe(...songs: NeteaseSong[]) {
  const ids = songs.map(song => song.id)
  observePlaylistSourceTracks({ sourceId: 'source', managedSongs: songs, managedSongIds: ids, allSongIds: ids })
}

it('keeps only a verifiable recording for bulk selection', () => {
  expect(assessBatchPlexCandidate(song, track, '1', matching)).toMatchObject({ ratingKey: '11', owners: [] })
  for (const different of [
    { ...track, title: 'Studio Song (instrumental)' },
    { ...track, title: 'Studio Song (live)' },
    { ...track, grandparentTitle: 'Another Artist' },
    { ...track, title: 'Studio Songbook' },
    { ...track, duration: 0 },
    { ...track, Media: [{ Part: [{ file: '/music/one.flac' }, { file: '/music/two.flac' }] }] },
  ]) expect(assessBatchPlexCandidate(song, different, '1', matching)).toBeNull()
  expect(assessBatchPlexCandidate({ ...song, artists: [] }, track, '1', matching)).toBeNull()
})

it('shows the existing version and blocks sharing when the old song is a different recording', () => {
  observe(song, { ...song, id: 2, name: 'Studio Song (Orchestral)', dt: 184000 })
  rebindSongIdentity({ neteaseSongId: 2, expectedBindingUpdatedAt: null, binding: existing })
  const candidate = assessBatchPlexCandidate(song, track, '1', matching)
  expect(candidate?.owners).toMatchObject([{ songId: 2, title: 'Studio Song (Orchestral)', durationMs: 184000 }])
  expect(candidate?.shareIssue).toContain('请先核对原关联')
})

it('preserves an existing managed identity across explicit sharing and later ownership checks', () => {
  observe(song, { ...song, id: 2, album: { ...song.album, id: 2, name: 'Another Release' } })
  const managed = upsertSongIdentityBinding({ ...existing, neteaseSongId: 2, bindingMethod: 'path', status: 'active' })
  const candidate = assessBatchPlexCandidate(song, track, '1', matching)
  expect(candidate?.owners).toMatchObject([{ songId: 2, album: 'Another Release', updatedAt: managed.updatedAt }])
  expect(candidate?.shareIssue).toBeUndefined()

  const request = { songId: 1, expectedBindingUpdatedAt: null, sourceId: 'source', track, sectionKey: '1', sectionRoot: '/music' }
  expect(() => saveManualPlexBinding(request)).toThrow('已关联到另一首')
  const confirmed = saveManualPlexBinding({ ...request, batch: { changeId: 'batch', plexFilePath: existing.plexFilePath, sharedWithSongIds: [2] } })
  expect(getSongIdentityBinding(2)).toEqual(managed)
  const bindings = new Map([[1, confirmed.binding], [2, managed]])
  expect(conflictingLookupOwner(1, '11', new Map(), bindings)).toBeUndefined()
  expect(conflictingLookupOwner(2, '11', new Map(), bindings)).toBeUndefined()
})
