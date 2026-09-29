import { describe, expect, it } from 'vitest'
import { matchingPreset } from '../../../shared/initialization-matching'
import { buildInitializationPlans } from './candidate-engine'
import type { NeteaseSong } from '../netease'
import type { PlexTrack } from '../plex-client'
const song: NeteaseSong = { id: 42, name: 'Song', no: 1, dt: 180000, disc: '1', artists: [], album: { id: 1, name: 'Album', picUrl: '', publishTime: 0 } }
const track: PlexTrack = { ratingKey: '100', title: 'Song', grandparentTitle: 'Various Artists', parentTitle: 'Album', index: 1, duration: 180000, Media: [{ Part: [{ file: '/music/Song.flac' }] }] }
const config = { ...matchingPreset('balanced'), corroboratedRecommendations: false }
function plan(names: string[], artist: string, songTitle = 'Song', trackTitle = 'Song') {
  return buildInitializationPlans({ songs: [{ ...song, name: songTitle, artists: names.map(name => ({ name })) }], tracks: [{ ...track, title: trackTitle, originalTitle: artist }], bindings: new Map(), matching: config })[0]!
}
describe('structured artist credit parsing', () => {
  it.each([
    [['Taylor Swift', 'Florence + The Machine'], 'Taylor Swift&Florence + The Machine'],
    [['澤野弘之', 'R!N/Gemie', '英雄联盟'], '澤野弘之&R!N/Gemie&英雄联盟'],
    [['Alpha', 'Moments With You'], 'Alpha feat. Moments With You'],
    [['Post Malone', 'Doja Cat'], 'Post Malone w. Doja Cat'],
    [['Rosa Walton', 'Hallie Coggins'], 'Rosa Walton as Hallie Coggins'],
    [['Macklemore & Ryan Lewis', 'Wanz'], 'Macklemore & Ryan Lewis feat. Wanz'],
  ])('retains known whole names in %j', (names, artist) => {
    expect(plan(names, artist).tier).toBe('high_confidence')
  })
  it('preserves compound names in feat title credits on both sides', () => {
    expect(plan(['Alpha', 'Tegan & Sara'], 'Alpha', 'Song (feat. Tegan & Sara)', 'Song (feat. Tegan & Sara)').tier).toBe('high_confidence')
    expect(plan(['Alpha'], 'Alpha', 'Song (feat. Beta & Gamma)', 'Song (feat. Beta & Gamma)').tier).toBe('high_confidence')
  })
  it('never discards unrecognized or extra participants', () => {
    expect(plan(['Taylor Swift', 'Florence + The Machine'], 'Taylor Swift&Florence + The Machine&Someone Else').tier).not.toBe('high_confidence')
    expect(plan(['Alpha'], 'Alpha w. Beta').tier).not.toBe('high_confidence')
    expect(plan(['Alpha', 'Beta'], 'Alpha feat. Another').tier).not.toBe('high_confidence')
  })
})
