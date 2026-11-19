import { describe, expect, it } from 'vitest'
import { matchingPreset } from '~~/shared/initialization-matching'
import { buildInitializationPlans } from '~~/server/lib/source-initialization/candidate-engine'
import type { NeteaseSong } from '~~/server/lib/netease'
import type { PlexTrack } from '~~/server/lib/plex-client'
const song: NeteaseSong = { id: 42, name: 'Song', no: 3, dt: 180000, disc: '1', artists: [{ name: 'Alpha' }], album: { id: 1, name: 'Original Album', picUrl: '', publishTime: 0 } }
const target: PlexTrack = { ratingKey: 'original', title: 'Song', grandparentTitle: 'Alpha', parentTitle: 'Original Album', index: 3, duration: 180000, Media: [{ Part: [{ file: '/music/Original Album/03 Song.flac' }] }] }
const compilation: PlexTrack = { ...target, ratingKey: 'compilation', parentTitle: 'Compilation', index: 9, Media: [{ Part: [{ file: '/music/Compilation/09 Song.flac' }] }] }
function plan(tracks = [compilation, target], config = matchingPreset('balanced')) {
  return buildInitializationPlans({ songs: [song], tracks, bindings: new Map(), matching: { ...config, duplicatePolicy: 'review' } })[0]!
}
describe('unique target album preference', () => {
  it('selects a strictly corroborated target edition while retaining alternatives', () => {
    const result = plan()
    expect(result.tier).toBe('high_confidence')
    expect(result.candidate?.ratingKey).toBe('original')
    expect(result.candidates).toHaveLength(2)
    expect(result.decision).toBe('defer')
    expect(result.evidence.reasons).toEqual(expect.arrayContaining([expect.stringContaining('目标专辑唯一优选')]))
    expect(plan([target, compilation]).candidate?.ratingKey).toBe('original')
  })
  it('respects disabled and ignored policies', () => {
    expect(plan(undefined, { ...matchingPreset('balanced'), preferExactAlbum: false }).tier).toBe('ambiguous')
    expect(plan(undefined, { ...matchingPreset('balanced'), albumPolicy: 'ignore' }).tier).toBe('ambiguous')
    expect(plan(undefined, { ...matchingPreset('balanced'), trackPolicy: 'ignore' }).tier).toBe('ambiguous')
  })
  it('never selects arbitrary same-album duplicates or weak evidence', () => {
    expect(plan([target, { ...target, ratingKey: 'duplicate' }]).tier).toBe('ambiguous')
    for (const patch of [{ index: 0 }, { duration: 180501 }, { parentTitle: 'Other Album' }]) expect(plan([{ ...target, ...patch }, compilation]).tier).toBe('ambiguous')
  })
  it('does not treat directory-only artist corroboration as full artist identity', () => {
    const romanized = { ...target, grandparentTitle: 'Different Artist', Media: [{ Part: [{ file: '/music/Alpha/Original Album/03 Song.flac' }] }] }
    expect(plan([romanized, compilation]).tier).toBe('ambiguous')
  })
})
