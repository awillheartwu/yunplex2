import { describe, expect, it } from 'vitest'
import type { NeteaseSong } from '../netease'
import type { PlexTrack } from '../plex-client'
import type { SongIdentityBinding } from '../sync/identity-store'
import { buildInitializationPlans } from './candidate-engine'

function song(overrides: Partial<NeteaseSong> = {}): NeteaseSong {
  return {
    id: 42,
    name: 'Signal',
    no: 3,
    dt: 180_000,
    disc: '1',
    artists: [{ name: 'Alpha' }, { name: 'Beta' }],
    album: { id: 7, name: 'Night Drive', picUrl: '', publishTime: 0 },
    ...overrides,
  }
}

function track(overrides: Partial<PlexTrack> = {}): PlexTrack {
  return {
    ratingKey: '100',
    title: 'Signal',
    grandparentTitle: 'Alpha & Beta',
    parentTitle: 'Night Drive',
    index: 3,
    duration: 181_500,
    Media: [{ Part: [{ file: '/music/Alpha/Night Drive/03 Signal.flac' }] }],
    ...overrides,
  }
}

function classify(songs: NeteaseSong[], tracks: PlexTrack[]) {
  return buildInitializationPlans({ songs, tracks, bindings: new Map() })
}

function binding(overrides: Partial<SongIdentityBinding> = {}): SongIdentityBinding {
  return {
    neteaseSongId: 42,
    plexSectionKey: '12',
    plexFilePath: '/music/Alpha/Night Drive/03 Signal.flac',
    plexRelativePath: 'Alpha/Night Drive/03 Signal.flac',
    plexRatingKey: '100',
    bindingMethod: 'path',
    status: 'active',
    evidence: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    lastVerifiedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  }
}

describe('first media adoption candidate engine', () => {
  it('preserves an active binding only when its current Plex path is still present', () => {
    const result = buildInitializationPlans({
      songs: [song()],
      tracks: [track()],
      bindings: new Map([[42, binding()]]),
    })[0]!

    expect(result).toMatchObject({
      tier: 'preserved',
      candidate: { ratingKey: '100', filePath: '/music/Alpha/Night Drive/03 Signal.flac' },
      evidence: { rule: 'active_binding_verified', bindingMethod: 'path' },
    })
  })

  it('reclassifies an active binding when its rating key or path is no longer visible in Plex', () => {
    const result = buildInitializationPlans({
      songs: [song()],
      tracks: [track({ ratingKey: '101' })],
      bindings: new Map([[42, binding()]]),
    })[0]!

    expect(result).toMatchObject({ tier: 'high_confidence', decision: 'defer' })
  })

  it('preselects one exact netease path identity', () => {
    const result = classify([song()], [track({ Media: [{ Part: [{ file: '/music/Signal [netease-42].flac' }] }] })])[0]!
    expect(result).toMatchObject({ tier: 'strong_id', decision: 'adopt' })
  })

  it('does not preselect strict metadata-only candidates', () => {
    const result = classify([song()], [track()])[0]!
    expect(result).toMatchObject({ tier: 'high_confidence', decision: 'defer' })
  })

  it('enforces the two-second high-confidence duration boundary', () => {
    expect(classify([song()], [track({ duration: 182_000 })])[0]!.tier).toBe('high_confidence')
    expect(classify([song()], [track({ duration: 182_001 })])[0]!.tier).toBe('possible')
  })

  it('requires the complete artist set and exact track number for high confidence', () => {
    expect(classify([song()], [track({ grandparentTitle: 'Alpha', index: 4 })])[0]!.tier).toBe('possible')
  })

  it('does not collapse incompatible Live and studio versions', () => {
    expect(classify([song({ name: 'Signal (Live)' })], [track({ title: 'Signal' })])[0]!.tier).toBe('unmatched')
    expect(classify([song({ name: 'Signal (Live)' })], [track({ title: 'Signal (Live)' })])[0]!.tier).toBe('high_confidence')
  })

  it('does not collapse incompatible Remix and original versions', () => {
    expect(classify([song({ name: 'Signal (Remix)' })], [track({ title: 'Signal' })])[0]!.tier).toBe('unmatched')
    expect(classify([song({ name: 'Signal (Remix)' })], [track({ title: 'Signal (Remix)' })])[0]!.tier).toBe('high_confidence')
  })

  it('does not treat Plex agent GUIDs as candidate identity', () => {
    const result = classify([song()], [track({
      title: 'Completely Different',
      Guid: [{ id: 'com.plexapp.agents.netease://42' }],
      guid: 'netease://42',
    })])[0]!
    expect(result).toMatchObject({ tier: 'unmatched', candidate: null, candidates: [] })
  })

  it('returns a conflict when one song id appears on multiple safe Plex paths', () => {
    const tagged = (ratingKey: string) => track({ ratingKey, Media: [{ Part: [{ file: `/music/${ratingKey} [netease-42].flac` }] }] })
    expect(classify([song()], [tagged('100'), tagged('101')])[0]!).toMatchObject({ tier: 'conflict', decision: 'defer' })
  })

  it('never upgrades a fuzzy title to a candidate', () => {
    expect(classify([song()], [track({ title: 'Signals' })])[0]!).toMatchObject({ tier: 'unmatched', candidates: [] })
  })

  it('distinguishes one title-only candidate from multiple ambiguous candidates', () => {
    const titleOnly = track({ grandparentTitle: 'Different Artist', duration: 250_000 })
    expect(classify([song()], [titleOnly])[0]!).toMatchObject({
      tier: 'ambiguous',
      evidence: { rule: 'title_only_candidate' },
      candidates: [expect.objectContaining({ ratingKey: '100' })],
    })
    expect(classify([song()], [titleOnly, track({ ratingKey: '101', grandparentTitle: 'Another Artist', duration: 260_000 })])[0]!)
      .toMatchObject({ tier: 'ambiguous', evidence: { rule: 'multiple_local_candidates' } })
  })

  it('keeps duplicate playlist occurrences in one review item', () => {
    expect(classify([song(), song()], [track()])[0]!).toMatchObject({ occurrenceCount: 2, position: 0 })
  })
})
