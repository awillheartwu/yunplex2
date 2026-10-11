import { describe, expect, it } from 'vitest'
import { matchingPreset, type InitializationMatchingConfig } from '~~/shared/initialization-matching'
import { artistMatchingKey } from '~~/shared/initialization-matching-text'
import { buildInitializationPlans } from '~~/server/lib/source-initialization/candidate-engine'
import { artistCreditKeys } from '~~/server/lib/source-initialization/artist-credits'
import { validateInitializationMatching } from '~~/server/lib/config/initialization-matching-validation'
import { uniqueMusicBrainzArtist } from '~~/server/lib/source-initialization/musicbrainz-aliases'

const song = { id: 42, name: '红', no: 1, dt: 180000, disc: '1', artists: [{ name: 'Alpha' }], album: { id: 1, name: 'Album', picUrl: '', publishTime: 0 } }
const track = { ratingKey: '10', title: '红 Love', grandparentTitle: 'Alpha', parentTitle: 'Album', index: 1, duration: 180000, Media: [{ Part: [{ file: '/music/Alpha/Red.flac' }] }] }
const config = matchingPreset('balanced')
const run = (patch: Partial<InitializationMatchingConfig> = {}, media = track) => buildInitializationPlans({ songs: [song], tracks: [media], bindings: new Map(), matching: { ...config, ...patch } })[0]!

describe('artist credit and bilingual title refinements', () => {
  it('makes secondary Chinese titles recommendable only with independent corroboration', () => {
    expect(run().tier).toBe('possible')
    const result = run({ corroboratedBilingualTitles: true })
    expect(result.tier).toBe('high_confidence')
    expect(result.decision).toBe('defer')
    for (const patch of [{ parentTitle: 'Other' }, { index: 2 }, { duration: 180501 }, { grandparentTitle: 'Wrong' }, { title: '红 Love (Live)' }]) {
      expect(run({ corroboratedBilingualTitles: true }, { ...track, ...patch }).tier).not.toBe('high_confidence')
    }
    expect(run({ corroboratedBilingualTitles: true, bilingualTitles: false }).tier).not.toBe('high_confidence')
    expect(run({ corroboratedBilingualTitles: true, albumPolicy: 'ignore' }).tier).not.toBe('high_confidence')
  })
  it('folds Latin artist accents only when enabled and preserves Japanese voicing', () => {
    const folded = { ...config, foldArtistDiacritics: true }
    expect(artistMatchingKey('JAŸ-Z', folded)).toBe(artistMatchingKey('JAY-Z', folded))
    expect(artistMatchingKey('GIVĒON', config)).not.toBe(artistMatchingKey('Giveon', config))
    expect(artistMatchingKey('バンド', folded)).not.toBe(artistMatchingKey('ハンド', folded))
    const target = { ...song, name: 'Signal', artists: [{ name: 'Drake' }, { name: 'GIVĒON' }] }
    const media = { ...track, title: 'Signal', originalTitle: 'Drake & Giveon', grandparentTitle: 'Drake' }
    expect(buildInitializationPlans({ songs: [target], tracks: [media], bindings: new Map(), matching: folded })[0]!.tier).toBe('high_confidence')
    expect(() => validateInitializationMatching({ ...folded, artistAliases: [
      { name: 'Beyoncé', aliases: ['One'], enabled: true }, { name: 'Beyonce', aliases: ['Two'], enabled: true },
    ] })).toThrow('重叠')
  })
  it('splits project credits only when each component is already known', () => {
    const known = ['SawanoHiroyuki[nZk]', 'mizuki'].map(name => new Set([artistMatchingKey(name, config)]))
    expect(artistCreditKeys(['SawanoHiroyuki[nZk]:mizuki'], known, config)).toEqual(['sawanohiroyukinzk', 'mizuki'])
    expect(artistCreditKeys(['SawanoHiroyuki[nZk]:unknown'], known, config)).toHaveLength(1)
    expect(artistCreditKeys(['AC:DC'], [new Set([artistMatchingKey('AC:DC', config)])], config)).toEqual(['acdc'])
  })
  it('requires both embedded artist names to occur on one unique MB record', () => {
    const artist = { id: 'f760b097-e57c-4037-86f6-24a474c1b4dc', name: '瑞葵', score: 100, aliases: [{ name: 'mizuki' }] }
    expect(uniqueMusicBrainzArtist('瑞葵(mizuki)', { count: 1, artists: [artist] }, config)?.id).toBe(artist.id)
    expect(uniqueMusicBrainzArtist('瑞葵(mizuki)', { count: 1, artists: [{ ...artist, aliases: [] }] }, config)).toBeNull()
    expect(uniqueMusicBrainzArtist('瑞葵(mizuki)', { count: 2, artists: [artist, { ...artist, id: 'different' }] }, config)).toBeNull()
  })
})
