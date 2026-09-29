import { describe, expect, it } from 'vitest'
import { matchingPreset, type InitializationMatchingConfig } from '../../../shared/initialization-matching'
import type { NeteaseSong } from '../netease'
import type { PlexTrack } from '../plex-client'
import { buildInitializationPlans } from './candidate-engine'

const song: NeteaseSong = { id: 42, name: 'Signal', no: 1, dt: 180000, disc: '1', artists: [{ name: 'Alpha' }], album: { id: 1, name: 'Single', picUrl: '', publishTime: 0 } }
const track: PlexTrack = { ratingKey: '100', title: 'Signal', grandparentTitle: 'Alpha', parentTitle: 'Single', index: 1, duration: 180000, Media: [{ Part: [{ file: '/music/Alpha/Signal.flac' }] }] }
function plan(s: Partial<NeteaseSong> = {}, ts: PlexTrack[] = [track], policy: Partial<InitializationMatchingConfig> = {}) {
  return buildInitializationPlans({ songs: [{ ...song, ...s }], tracks: ts, bindings: new Map(), matching: { ...matchingPreset('balanced'), duplicatePolicy: 'review', ...policy } })[0]!
}

describe('configurable initialization candidate evidence', () => {
  it('uses compilation track artists without requiring album or index equality', () => {
    const result = plan({}, [{ ...track, grandparentTitle: 'Various Artists', originalTitle: 'Alpha', parentTitle: 'Compilation', index: 12 }])
    expect(result.tier).toBe('high_confidence')
    expect(result.decision).toBe('defer')
    expect(plan({}, [{ ...track, grandparentTitle: 'Various Artists', originalTitle: 'Alpha' }], { useTrackArtist: false, usePathHints: false }).tier).toBe('ambiguous')
  })
  it('respects optional strict album and track gates', () => {
    expect(plan({}, [{ ...track, index: 2 }], { trackPolicy: 'require' }).tier).toBe('ambiguous')
    expect(plan({}, [{ ...track, parentTitle: 'Other' }], { albumPolicy: 'require' }).tier).toBe('ambiguous')
  })
  it('preserves whole band names before splitting collaborators', () => {
    expect(plan({ artists: [{ name: 'Polo & Pan' }] }, [{ ...track, grandparentTitle: 'Polo & Pan' }]).tier).toBe('high_confidence')
    expect(plan({ artists: [{ name: 'Alpha' }, { name: 'Beta' }] }, [{ ...track, grandparentTitle: 'Alpha feat. Beta' }]).tier).toBe('high_confidence')
  })
  it('uses confirmed aliases bidirectionally and never aliases supplied only through download settings', () => {
    const aliases = [{ name: '刘森', aliases: ['Liu Sen'], enabled: true }]
    expect(plan({ artists: [{ name: '刘森' }] }, [{ ...track, grandparentTitle: 'Liu Sen' }], { artistAliases: aliases }).tier).toBe('high_confidence')
    expect(plan({ artists: [{ name: 'Liu Sen' }] }, [{ ...track, grandparentTitle: '刘森' }], { artistAliases: aliases }).tier).toBe('high_confidence')
    expect(plan({ artists: [{ name: '刘森' }] }, [{ ...track, grandparentTitle: 'Liu Sen' }], { artistAliases: aliases, useArtistAliases: false }).tier).toBe('ambiguous')
  })
  it('normalizes script and typography only when enabled', () => {
    expect(plan({ name: '再见' }, [{ ...track, title: '再見' }]).tier).toBe('high_confidence')
    expect(plan({ name: '再见' }, [{ ...track, title: '再見' }], { foldChinese: false, metadataFallback: false }).tier).toBe('unmatched')
    expect(plan({ name: 'A-O-K' }, [{ ...track, title: 'A‐O‐K' }]).tier).toBe('high_confidence')
  })
  it('removes recognized movie context without dropping arbitrary bracket text', () => {
    expect(plan({ name: 'Signal [From The Movie]' }).tier).toBe('high_confidence')
    expect(plan({ name: 'Signal (Different Composition)' }, [track], { supplementalTitleRecall: false, metadataFallback: false }).tier).toBe('unmatched')
  })
  it('keeps equal-duration instrumental and remix conflicts out of recommendations', () => {
    for (const suffix of ['instrumental', 'Carousel Remix', 'Live']) {
      const result = plan({}, [{ ...track, title: `Signal (${suffix})` }])
      expect(result.tier).toBe('ambiguous')
      expect(result.candidate).toBeNull()
      expect(result.evidence.classification).toBe('version_conflict')
    }
  })
  it('compares remix authors and recognizes dash suffix versions', () => {
    expect(plan({ name: 'Signal (One Remix)' }, [{ ...track, title: 'Signal - Two Remix' }]).evidence.classification).toBe('version_conflict')
    expect(plan({ name: 'Signal (One Remix)' }, [{ ...track, title: 'Signal - One Remix' }]).tier).toBe('high_confidence')
    expect(plan({ name: 'Signal (Radio Edit)' }, [{ ...track, title: 'Signal (Lucas & Steve Radio Edit)' }]).tier).not.toBe('high_confidence')
  })
  it('protects paired Japanese version suffixes even during fuzzy recall', () => {
    for (const title of ['Signal -Instrumental-', 'Signal 〜Instrumental〜', 'Signal ～Instrumental～', 'Signal ~Instrumental~']) {
      const result = plan({}, [{ ...track, title }], { fuzzyTitles: true })
      expect(result.evidence.classification).toBe('version_conflict')
      expect(result.candidate).toBeNull()
      expect(plan({ name: 'Signal (Instrumental)' }, [{ ...track, title }]).tier).toBe('high_confidence')
    }
    expect(plan({}, [{ ...track, title: 'Signal 〜album version〜' }]).tier).toBe('possible')
    expect(plan({ name: 'Signal ~A New World~' }, [{ ...track, title: 'Signal ~A New World~' }]).tier).toBe('high_confidence')
  })
  it('allows configurable remaster treatment but never turns missing version into a silent match', () => {
    const ts = [{ ...track, title: 'Signal (2010 Remaster)' }]
    expect(plan({}, ts).tier).toBe('possible')
    expect(plan({}, ts, { remasterPolicy: 'allow' }).tier).toBe('high_confidence')
    expect(plan({}, ts, { unknownVersion: 'exclude' }).tier).toBe('unmatched')
  })
  it('requires both absolute and relative duration thresholds', () => {
    expect(plan({ dt: 20000 }, [{ ...track, duration: 20500 }]).tier).toBe('possible')
    expect(plan({}, [{ ...track, duration: 183000 }]).tier).toBe('possible')
    expect(plan({}, [{ ...track, duration: 190000 }]).tier).toBe('ambiguous')
    expect(plan({}, [{ ...track, duration: undefined }], { missingDuration: 'exclude' }).tier).toBe('unmatched')
  })
  it('does not promote directory hints or fuzzy titles to batch recommendations', () => {
    expect(plan({}, [{ ...track, grandparentTitle: 'Wrong Scrape' }]).tier).toBe('possible')
    expect(plan({}, [{ ...track, title: 'Signall' }], { fuzzyTitles: true }).tier).toBe('possible')
    expect(plan({}, [{ ...track, title: 'Signall' }], { fuzzyTitles: false, usePathHints: false, metadataFallback: false }).tier).toBe('unmatched')
  })
  it('retains competing candidates despite format and directory preferences', () => {
    const result = plan({}, [track, { ...track, ratingKey: '101', Media: [{ Part: [{ file: '/preferred/Signal.mp3' }] }] }], { preferredDirectory: '/preferred' })
    expect(result.tier).toBe('ambiguous')
    expect(result.evidence.classification).toBe('duplicates')
    expect(result.candidate).toBeNull()
    expect(result.candidates[0]!.ratingKey).toBe('101')
  })
  it('deduplicates the same ratingKey across retrieval routes', () => {
    expect(plan({}, [track, track]).tier).toBe('high_confidence')
  })
  it('keeps legacy behavior when enhancement is disabled', () => {
    expect(plan({}, [{ ...track, parentTitle: 'Compilation', index: 5 }], { enabled: false }).tier).toBe('possible')
  })
  it('never recommends media explicitly marked as another NetEase song', () => {
    const result = plan({}, [{ ...track, Media: [{ Part: [{ file: '/music/Signal [netease-999].flac' }] }] }])
    expect(result.tier).toBe('conflict')
    expect(result.candidate).toBeNull()
  })
  it('detects collisions between two songs before either is adopted', () => {
    const result = buildInitializationPlans({ songs: [song, { ...song, id: 43 }], tracks: [track], bindings: new Map(), matching: matchingPreset('balanced') })
    expect(result.every(item => item.tier === 'conflict' && !item.candidate && item.decision === 'defer')).toBe(true)
  })
})
