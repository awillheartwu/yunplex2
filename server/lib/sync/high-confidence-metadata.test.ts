import { describe, expect, it } from 'vitest'
import type { NeteaseSong } from '../netease'
import { evaluateHighConfidenceMetadataMatch } from './high-confidence-metadata'

const vanish: NeteaseSong = {
  id: 427542077,
  name: 'Vanish (feat. KARRA)',
  no: 4,
  dt: 224000,
  disc: '1',
  artists: [{ name: 'Breathe Carolina' }, { name: 'Crossnaders' }, { name: 'Karra' }],
  album: { id: 1, name: 'Sleepless', picUrl: '', publishTime: 1473984000000 },
}

const plexTrack = {
  ratingKey: '7647',
  title: 'Vanish',
  grandparentTitle: 'Breathe Carolina',
  originalTitle: 'Breathe Carolina & Crossnaders feat. Karra',
  parentTitle: 'Sleepless',
  index: 4,
  duration: 224400,
}

describe('high-confidence metadata identity', () => {
  it('requires title, complete artist credit, album, track number and duration to all match', () => {
    const result = evaluateHighConfidenceMetadataMatch(vanish, plexTrack, 2000)

    expect(result).toMatchObject({
      matched: true,
      title: { matched: true },
      artists: { matched: true, completeCreditAvailable: true },
      album: { matched: true },
      trackNumber: { matched: true },
      duration: { matched: true, deltaMs: 400, toleranceMs: 2000 },
      failureReasons: [],
    })
  })

  it('rejects a multi-artist target when Plex exposes only the primary artist', () => {
    const result = evaluateHighConfidenceMetadataMatch(vanish, { ...plexTrack, originalTitle: undefined }, 2000)

    expect(result.matched).toBe(false)
    expect(result.artists).toMatchObject({ matched: false, completeCreditAvailable: false })
    expect(result.failureReasons).toContain('complete_artist_credit_unavailable')
  })

  it('recovers an explicit featured artist from the Plex track title', () => {
    const target: NeteaseSong = {
      ...vanish,
      name: 'Selfish',
      no: 15,
      dt: 251472,
      artists: [{ name: 'Future' }, { name: 'Rihanna' }],
      album: { ...vanish.album, name: 'HNDRXX' },
    }
    const candidate = {
      ...plexTrack,
      title: 'Selfish (feat. Rihanna)',
      grandparentTitle: 'Future',
      originalTitle: undefined,
      parentTitle: 'HNDRXX',
      index: 15,
      duration: 251422,
    }

    const result = evaluateHighConfidenceMetadataMatch(target, candidate, 2000)

    expect(result).toMatchObject({
      matched: true,
      artists: {
        candidate: ['Future', 'Rihanna'],
        matched: true,
        completeCreditAvailable: true,
      },
      failureReasons: [],
    })
  })

  it('does not interpret version descriptors in brackets as artist credits', () => {
    const result = evaluateHighConfidenceMetadataMatch(
      vanish,
      {
        ...plexTrack,
        title: 'Vanish (Live at Home)',
        grandparentTitle: 'Breathe Carolina',
        originalTitle: undefined,
      },
      2000,
    )

    expect(result.artists.candidate).toEqual(['Breathe Carolina'])
    expect(result.artists.completeCreditAvailable).toBe(false)
  })

  it('accepts a resolved alias for a complete single-artist credit', () => {
    const target = { ...vanish, artists: [{ name: '陈奕迅' }] }
    const candidate = { ...plexTrack, grandparentTitle: 'Eason Chan', originalTitle: undefined }

    const result = evaluateHighConfidenceMetadataMatch(target, candidate, 2000, ['陈奕迅', 'Eason Chan'])

    expect(result.artists).toMatchObject({ matched: true, completeCreditAvailable: true })
  })

  it('does not accept partial artist-name containment as a complete credit match', () => {
    const result = evaluateHighConfidenceMetadataMatch(
      vanish,
      { ...plexTrack, originalTitle: 'Breathe Carolina Band & Crossnaders feat. Karra' },
      2000,
    )

    expect(result.matched).toBe(false)
    expect(result.artists.matched).toBe(false)
    expect(result.failureReasons).toContain('artist_set_mismatch')
  })

  it('does not collapse identity-bearing version descriptors', () => {
    const result = evaluateHighConfidenceMetadataMatch(
      { ...vanish, name: 'Vanish (Live)' },
      plexTrack,
      2000,
    )

    expect(result.matched).toBe(false)
    expect(result.title.matched).toBe(false)
  })

  it('requires track number and bounded duration instead of treating missing fields as matches', () => {
    const result = evaluateHighConfidenceMetadataMatch(
      vanish,
      { ...plexTrack, index: undefined, duration: 230001 },
      2000,
    )

    expect(result.matched).toBe(false)
    expect(result.trackNumber.matched).toBe(false)
    expect(result.duration).toMatchObject({ matched: false, deltaMs: 6001 })
    expect(result.failureReasons).toEqual(expect.arrayContaining(['track_number_missing', 'duration_out_of_tolerance']))
  })
})
