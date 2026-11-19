import { describe, expect, it } from 'vitest'
import { matchingPreset, type InitializationMatchingConfig } from '~~/shared/initialization-matching'
import type { NeteaseSong } from '~~/server/lib/netease'
import type { PlexTrack } from '~~/server/lib/plex-client'
import { buildInitializationPlans } from '~~/server/lib/source-initialization/candidate-engine'

const song: NeteaseSong = { id: 42, name: '麦子', no: 9, dt: 266000, disc: '1', artists: [{ name: '汉堡黄' }], album: { id: 1, name: '少女，飞', picUrl: '', publishTime: 0 } }
const track: PlexTrack = { ratingKey: '100', title: '麦子', grandparentTitle: 'Hanbao Huang', parentTitle: '少女，飞', index: 9, duration: 266000, Media: [{ Part: [{ file: '/music/汉堡黄/少女，飞 (2025)/09 - 麦子.flac' }] }] }
function plans(s: Partial<NeteaseSong> = {}, t: PlexTrack[] = [track], policy: Partial<InitializationMatchingConfig> = {}) {
  return buildInitializationPlans({ songs: [{ ...song, ...s }], tracks: t, bindings: new Map(), matching: { ...matchingPreset('balanced'), corroboratedRecommendations: true, duplicatePolicy: 'review', ...policy } })
}
describe('cross-checked metadata recommendation', () => {
  it('recommends only an explicit, unique cross-check and leaves adoption to confirmation', () => {
    const plan = plans()[0]!
    expect(plan.tier).toBe('high_confidence')
    expect(plan.decision).toBe('defer')
    expect(plan.evidence.reasons).toEqual(expect.arrayContaining([expect.stringContaining('交叉证据推荐')]))
    expect(plans({}, [track], { corroboratedRecommendations: false })[0]!.tier).toBe('possible')
    expect(plans({}, [track], { usePathHints: false })[0]!.tier).not.toBe('high_confidence')
    expect(plans({}, [track], { albumPolicy: 'ignore' })[0]!.tier).not.toBe('high_confidence')
    expect(plans({}, [track], { trackPolicy: 'ignore' })[0]!.tier).not.toBe('high_confidence')
  })
  it('requires album, positive track number, a faithful filename and tight duration', () => {
    for (const override of [
      { parentTitle: 'Another album' }, { index: 0 }, { index: 8 }, { duration: 266501 },
      { Media: [{ Part: [{ file: '/music/汉堡黄/少女，飞/09 - Another song.flac' }] }] },
      { Media: [{ Part: [{ file: '/music/Someone/少女，飞/09 - 麦子.flac' }] }] },
    ]) expect(plans({}, [{ ...track, ...override }])[0]!.tier).not.toBe('high_confidence')
    expect(plans({ no: 0 })[0]!.tier).not.toBe('high_confidence')
    expect(plans({}, [track], { recommendDurationMs: 10 })[0]!.tier).toBe('high_confidence')
    expect(plans({}, [{ ...track, duration: 266020 }], { recommendDurationMs: 10 })[0]!.tier).not.toBe('high_confidence')
  })
  it('does not learn arbitrary aliases or override conflicting same-script artist names', () => {
    const chinese = { ...track, grandparentTitle: '黑屋乐队', Media: [{ Part: [{ file: '/music/黑豹乐队/少女，飞/09 - 麦子.flac' }] }] }
    expect(plans({ artists: [{ name: '黑豹乐队' }] }, [chinese])[0]!.tier).not.toBe('high_confidence')
    const latin = { ...track, grandparentTitle: 'Max Richter', Media: [{ Part: [{ file: '/music/Max Riser/少女，飞/09 - 麦子.flac' }] }] }
    expect(plans({ artists: [{ name: 'Max Riser' }] }, [latin])[0]!.tier).not.toBe('high_confidence')
  })
  it('does not treat an eponymous album directory as artist evidence', () => {
    expect(plans({ album: { ...song.album, name: '汉堡黄' } }, [{ ...track, parentTitle: '汉堡黄', Media: [{ Part: [{ file: '/music/汉堡黄/09 - 麦子.flac' }] }] }])[0]!.tier).not.toBe('high_confidence')
  })
  it('can recommend one missing collaborator only with all independent checks', () => {
    const t = { ...track, grandparentTitle: '汉堡黄' }
    expect(plans({ artists: [{ name: '汉堡黄' }, { name: 'Beta' }] }, [t])[0]!.tier).toBe('high_confidence')
    expect(plans({ artists: [{ name: '汉堡黄' }, { name: 'Beta' }, { name: 'Gamma' }] }, [t])[0]!.tier).not.toBe('high_confidence')
    expect(plans({ artists: [{ name: '汉堡黄' }, { name: 'Beta' }] }, [{ ...t, originalTitle: '汉堡黄 feat. Someone Else' }])[0]!.tier).not.toBe('high_confidence')
  })
  it('includes explicit credits on both sides instead of inventing missing artists', () => {
    const t = { ...track, title: '麦子 (feat. Beta)', grandparentTitle: '汉堡黄' }
    expect(plans({ name: '麦子 (feat. Beta)' }, [t], { corroboratedRecommendations: false })[0]!.tier).toBe('high_confidence')
  })
  it('retains version, duplicate, and foreign-identity blockers', () => {
    expect(plans({}, [{ ...track, title: '麦子 (Live)' }])[0]!.tier).not.toBe('high_confidence')
    expect(plans({}, [track, { ...track, ratingKey: '101' }])[0]!.tier).toBe('ambiguous')
    expect(plans({}, [{ ...track, Media: [{ Part: [{ file: '/music/汉堡黄/少女，飞/09 - 麦子 [netease-99].flac' }] }] }])[0]!.tier).toBe('conflict')
  })
})
