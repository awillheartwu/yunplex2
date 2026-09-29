import { describe, expect, it } from 'vitest'
import { matchingPreset, type InitializationMatchingConfig } from '../../../shared/initialization-matching'
import type { NeteaseSong } from '../netease'
import type { PlexTrack } from '../plex-client'
import { buildInitializationPlans } from './candidate-engine'

const song: NeteaseSong = { id: 42, name: 'Signal', no: 1, dt: 180000, disc: '1', artists: [{ name: 'Alpha' }], album: { id: 1, name: 'Album', picUrl: '', publishTime: 0 } }
const track: PlexTrack = { ratingKey: '100', title: 'Signal', grandparentTitle: 'Alpha', parentTitle: 'Album', index: 1, duration: 180000, Media: [{ Part: [{ file: '/music/Alpha/Signal.flac' }] }] }
function result(s: Partial<NeteaseSong>, t: Partial<PlexTrack>, settings: Partial<InitializationMatchingConfig> = {}) {
  return buildInitializationPlans({ songs: [{ ...song, ...s }], tracks: [{ ...track, ...t }], bindings: new Map(), matching: { ...matchingPreset('balanced'), supplementalTitleRecall: true, metadataFallback: true, ...settings } })[0]!
}

describe('bounded supplemental candidate recall', () => {
  it('retains punctuation-only titles without merging different literal titles', () => {
    expect(result({ name: '.' }, { title: '.' }).tier).toBe('high_confidence')
    expect(result({ name: '.' }, { title: '...' }, { metadataFallback: false }).tier).toBe('unmatched')
    expect(result({ name: '' }, { title: '' }, { metadataFallback: false }).tier).not.toBe('high_confidence')
  })
  it('finds short Original Mix titles, but keeps edition differences for review', () => {
    const found = result({ name: 'Blu (Original Mix)' }, { title: 'Blu' })
    expect(found.tier).toBe('possible')
    expect(found.evidence.reasons).toContain('发行版本信息不同，需确认')
  })
  it('finds reverse and slash-separated bilingual titles only as review candidates', () => {
    for (const [name, title] of [['夜曲', 'Nocturne/夜曲'], ['飘移', 'Drifting 飄移']]) {
      expect(result({ name }, { title }).tier).toBe('possible')
      expect(result({ name }, { title }, { supplementalTitleRecall: false, metadataFallback: false }).tier).toBe('unmatched')
    }
  })
  it('retains film subtitles and reordered brackets as review evidence', () => {
    expect(result({ name: 'Sunflower' }, { title: 'Sunflower (Spider-Man: Into the Spider-Verse)' }).tier).toBe('possible')
    expect(result({ name: '牵丝戏(神探狄仁杰)' }, { title: '【神探狄仁杰】牵丝戏' }).tier).toBe('possible')
  })
  it('extracts with and Vocal credits as participants rather than title words', () => {
    for (const credit of ['with Beta', 'Vocal: Beta', 'feat. Beta']) {
      expect(result({ artists: [{ name: 'Alpha' }, { name: 'Beta' }] }, { title: `Signal (${credit})` }).tier).toBe('high_confidence')
    }
  })
  it('distinguishes Vocal Mix version text from a Vocal participant credit', () => {
    expect(result({ name: 'Colors (Vocal Mix)', artists: [{ name: 'Tobu' }, { name: 'Hayley Williams' }] }, { title: 'Colors (Vocal Mix) (Vocal: Hayley Williams)', grandparentTitle: 'Tobu' }).tier).toBe('high_confidence')
    expect(result({ name: 'Colors (Vocal Mix)' }, { title: 'Colors' }).tier).not.toBe('high_confidence')
  })

  it('finds completely translated titles through album/track evidence without recommending', () => {
    const found = result({ name: '游戏继续' }, { title: 'Continue' })
    expect(found.tier).toBe('possible')
    expect(found.evidence.reasons).toContain('艺人、专辑、曲序与接近时长补充召回：标题不同，需确认')
    expect(result({ name: '游戏继续' }, { title: 'Continue' }, { metadataFallback: false }).tier).toBe('unmatched')
    for (const t of [{ title: 'Continue', grandparentTitle: 'Other', Media: [] }, { title: 'Continue', index: 2 }, { title: 'Continue', duration: 190000 }, { title: 'Continue', parentTitle: 'Other' }]) {
      expect(result({ name: '游戏继续' }, t).tier).toBe('unmatched')
    }
  })
  it('constrains numeric and spelling recall with independent artist and duration evidence', () => {
    expect(result({ name: '九公主' }, { title: '9公主' }).tier).toBe('possible')
    expect(result({ name: 'À la Folie - Hageshiku (Japanese version)' }, { title: 'À la Folie - Hagueshuki (Japanese version)', parentTitle: 'Other' }, { fuzzyTitles: true }).tier).toBe('possible')
    expect(result({ name: '九公主' }, { title: '9公主', duration: 210000 }).tier).toBe('unmatched')
  })
  it('requires matching catalog/movement and artist evidence for classical recall', () => {
    const name = 'Unaccompanied Cello Suite No. 1 in G Major, BWV 1007:I. Prélude'
    expect(result({ name }, { title: 'Cello Suite No. 1, BWV 1007: I. Prelude', parentTitle: 'Other' }).tier).toBe('possible')
    expect(result({ name }, { title: 'Cello Suite No. 1, BWV 1007: II. Allemande', parentTitle: 'Other' }).tier).toBe('unmatched')
    expect(result({ name }, { title: 'Cello Suite No. 1, BWV 1007: I. Prelude', grandparentTitle: 'Another Performer', Media: [], parentTitle: 'Other' }).tier).toBe('unmatched')
  })
  it('blocks equal-duration Japanese karaoke and solo-arrangement candidates', () => {
    for (const [name, title] of [['brave heart', 'brave heart (オリジナルカラオケ)'], ['清平调', '清平调 (独唱版)'], ['Song', 'Song (Sing Along with Alpha)']]) {
      const found = result({ name }, { title })
      expect(found.evidence.classification).toBe('version_conflict')
      expect(found.candidate).toBeNull()
    }
  })
  it('does not overwrite ownership with supplemental evidence', () => {
    const found = result({ name: '游戏继续' }, { title: 'Continue', Media: [{ Part: [{ file: '/music/Continue [netease-999].flac' }] }] })
    expect(found.tier).toBe('conflict')
  })
})
