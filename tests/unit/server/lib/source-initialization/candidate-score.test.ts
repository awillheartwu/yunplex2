import { describe, expect, it } from 'vitest'
import { matchingPreset, type InitializationMatchingConfig } from '~~/shared/initialization-matching'
import type { NeteaseSong } from '~~/server/lib/netease'
import type { PlexTrack } from '~~/server/lib/plex-client'
import { CANDIDATE_SCORE_BLOCKS, scoreCandidate } from '~~/server/lib/source-initialization/candidate-score'

const base = matchingPreset('balanced')
function config(patch: Partial<InitializationMatchingConfig> = {}): InitializationMatchingConfig {
  return { ...base, ...patch }
}
function song(patch: Partial<NeteaseSong> = {}): NeteaseSong {
  return {
    id: 42, name: 'Song', no: 4, dt: 180000, disc: '1', artists: [{ name: 'Artist' }],
    album: { id: 1, name: 'Album', picUrl: '', publishTime: 0 }, ...patch,
  }
}
function track(patch: Partial<PlexTrack> = {}): PlexTrack {
  return {
    ratingKey: '100', title: 'Song', grandparentTitle: 'Artist', parentTitle: 'Album', index: 4, duration: 180000,
    Media: [{ Part: [{ file: '/music/Artist/Album/04 Song.flac' }] }], ...patch,
  }
}

describe('candidate score totals', () => {
  it('scores an exact, complete candidate at 100', () => {
    const result = scoreCandidate(song(), track(), config())
    expect(result.version).toBe(1)
    expect(result.total).toBe(100)
    expect(result.eligible).toBe(true)
    expect(result.parts).toEqual({ title: 35, artists: 35, duration: 20, album: 7, track: 3 })
    expect(result.coverage).toBe(1)
    expect(result.completeArtists).toBe(true)
    expect(result.titleStrength).toBe(1)
    expect(result.durationDeltaMs).toBe(0)
    expect(result.blocked).toEqual([])
    expect(result.risks).toEqual([])
  })

  it('treats missing duration as coverage loss instead of a conflict', () => {
    const result = scoreCandidate(song({ dt: 0 }), track({ duration: undefined }), config())
    expect(result.durationDeltaMs).toBeNull()
    expect(result.parts.duration).toBe(0)
    expect(result.total).toBe(80)
    expect(result.coverage).toBeCloseTo(0.8, 10)
    expect(result.eligible).toBe(true)
    expect(result.blocked).toEqual([])
    expect(result.risks).toContain('missing-duration')
  })

  it('stops coverage at the known fields without rescaling parts', () => {
    const result = scoreCandidate(
      song({ no: 0, album: { id: 0, name: '', picUrl: '', publishTime: 0 } }),
      track({ index: 0, parentTitle: '', duration: 182500 }),
      config(),
    )
    expect(result.parts.album).toBe(0)
    expect(result.parts.track).toBe(0)
    expect(result.parts.duration).toBeCloseTo(10, 10)
    expect(result.total).toBe(80)
    expect(result.coverage).toBeCloseTo(0.9, 10)
    expect(result.eligible).toBe(true)
    expect(result.risks).toContain('missing-album')
    expect(result.risks).toContain('missing-track-number')
  })
})

describe('title strength', () => {
  it('treats an enabled title alias as an exact match', () => {
    const result = scoreCandidate(song(), track({ title: '歌' }), config({ titleAliases: [{ name: 'Song', aliases: ['歌'], enabled: true }] }))
    expect(result.titleStrength).toBe(1)
    expect(result.parts.title).toBe(35)
  })

  it('scores corroborated bilingual variants at 0.9 and looser overlaps at 0.8', () => {
    const corroborated = scoreCandidate(song({ name: '晴天' }), track({ title: '晴天 Sunny Day' }), config({ corroboratedBilingualTitles: true }))
    expect(corroborated.titleStrength).toBe(0.9)
    expect(corroborated.parts.title).toBeCloseTo(31.5, 10)

    const uncorroborated = scoreCandidate(song({ name: '晴天' }), track({ title: '晴天 Sunny Day' }), config())
    expect(uncorroborated.titleStrength).toBe(0.8)

    const looseDuration = scoreCandidate(
      song({ name: '晴天' }),
      track({ title: '晴天 Sunny Day', duration: 180600 }),
      config({ corroboratedBilingualTitles: true }),
    )
    expect(looseDuration.eligible).toBe(true)
    expect(looseDuration.titleStrength).toBe(0.8)
  })

  it('scores supplemental title keys at 0.8', () => {
    const result = scoreCandidate(song({ name: 'Song Title' }), track({ title: 'Song Title (附注)' }), config())
    expect(result.titleStrength).toBe(0.8)
  })

  it('caps fuzzy similarity at 0.7 and only uses it when enabled', () => {
    const capped = scoreCandidate(song({ name: 'abcdefghij' }), track({ title: 'abcdefghix' }), config({ fuzzyTitles: true }))
    expect(capped.titleStrength).toBe(0.7)
    expect(capped.parts.title).toBeCloseTo(24.5, 10)
    expect(capped.total).toBeCloseTo(89.5, 10)
    expect(capped.risks).toContain('fuzzy-title-match')

    const raw = scoreCandidate(song({ name: 'abcdefghij' }), track({ title: 'abcdxxxxxx' }), config({ fuzzyTitles: true }))
    expect(raw.titleStrength).toBeCloseTo(0.4, 10)
    expect(raw.parts.title).toBeCloseTo(14, 10)

    const disabled = scoreCandidate(song({ name: 'abcdefghij' }), track({ title: 'abcdefghix' }), config())
    expect(disabled.titleStrength).toBe(0)
    expect(disabled.parts.title).toBe(0)
  })
})

describe('artist strength', () => {
  it('weights the primary artist double and counts extra actual names', () => {
    const artists = [{ name: 'Alpha' }, { name: 'Beta' }]
    expect(scoreCandidate(song({ artists }), track({ grandparentTitle: 'Alpha & Beta' }), config()).parts.artists).toBe(35)
    expect(scoreCandidate(song({ artists }), track({ grandparentTitle: 'Alpha' }), config()).parts.artists).toBeCloseTo(35 * 2 / 3, 10)
    expect(scoreCandidate(song({ artists }), track({ grandparentTitle: 'Beta' }), config()).parts.artists).toBeCloseTo(35 / 3, 10)
    expect(scoreCandidate(song({ artists }), track({ grandparentTitle: 'Alpha & Beta & Gamma' }), config()).parts.artists).toBeCloseTo(35 * 3 / 4, 10)
  })

  it('merges title contributors into both artist sides', () => {
    const credited = scoreCandidate(
      song({ name: 'Song (feat. Beta)', artists: [{ name: 'Alpha' }] }),
      track({ grandparentTitle: 'Alpha & Beta' }),
      config(),
    )
    expect(credited.completeArtists).toBe(true)
    expect(credited.parts.artists).toBe(35)

    const onTrack = scoreCandidate(
      song({ artists: [{ name: 'Alpha' }, { name: 'Beta' }] }),
      track({ title: 'Song (feat. Beta)', grandparentTitle: 'Alpha' }),
      config(),
    )
    expect(onTrack.completeArtists).toBe(true)
    expect(onTrack.parts.artists).toBe(35)
  })

  it('uses artist aliases for disambiguation', () => {
    const aliases = [{ name: 'Giveon', aliases: ['GIVĒON'], enabled: true }]
    const aliased = scoreCandidate(song({ artists: [{ name: 'GIVĒON' }] }), track({ grandparentTitle: 'Giveon' }), config({ artistAliases: aliases }))
    expect(aliased.completeArtists).toBe(true)
    expect(aliased.parts.artists).toBe(35)

    const without = scoreCandidate(song({ artists: [{ name: 'GIVĒON' }] }), track({ grandparentTitle: 'Giveon' }), config())
    expect(without.eligible).toBe(false)
    expect(without.blocked).toContain(CANDIDATE_SCORE_BLOCKS.artistMismatch)
  })

  it('blocks a known different artist while tolerating placeholder credits', () => {
    const other = scoreCandidate(song(), track({ grandparentTitle: 'Other Artist' }), config())
    expect(other.eligible).toBe(false)
    expect(other.blocked).toContain(CANDIDATE_SCORE_BLOCKS.artistMismatch)
    expect(other.completeArtists).toBe(false)
    expect(other.parts.artists).toBe(0)

    const compilation = scoreCandidate(song(), track({ grandparentTitle: 'Various Artists' }), config())
    expect(compilation.eligible).toBe(true)
    expect(compilation.blocked).toEqual([])
    expect(compilation.parts.artists).toBe(0)
    expect(compilation.risks).toContain('extra-artists:1')
  })
})

describe('duration window', () => {
  it('keeps raw float duration scores beside the review window', () => {
    const near = scoreCandidate(song({ dt: 240000 }), track({ duration: 244800 }), config())
    expect(near.eligible).toBe(true)
    expect(near.parts.duration).toBeCloseTo(20 * (1 - 4800 / 5000), 10)

    const atLimit = scoreCandidate(song({ dt: 240000 }), track({ duration: 245000 }), config())
    expect(atLimit.eligible).toBe(true)
    expect(atLimit.parts.duration).toBe(0)

    const over = scoreCandidate(song({ dt: 240000 }), track({ duration: 245001 }), config())
    expect(over.eligible).toBe(false)
    expect(over.blocked).toContain(CANDIDATE_SCORE_BLOCKS.durationWindow)
    expect(over.parts.duration).toBe(0)

    const wide = scoreCandidate(song({ dt: 500000 }), track({ duration: 490000 }), config({ reviewDurationMs: 20000 }))
    expect(wide.parts.duration).toBeCloseTo(20 * (1 - 10000 / 20000), 10)

    const narrow = scoreCandidate(song({ dt: 500000 }), track({ duration: 502000 }), config({ reviewDurationMs: 200 }))
    expect(narrow.eligible).toBe(true)
    expect(narrow.parts.duration).toBeCloseTo(20 * (1 - 2000 / 10000), 10)
  })
})

describe('version evidence', () => {
  it('blocks one-sided version evidence and accepts identical versions', () => {
    const conflict = scoreCandidate(song(), track({ title: 'Song (Live)' }), config())
    expect(conflict.eligible).toBe(false)
    expect(conflict.blocked).toContain(CANDIDATE_SCORE_BLOCKS.versionConflict)

    const excluded = scoreCandidate(song(), track({ title: 'Song (Live)' }), config({ unknownVersion: 'exclude' }))
    expect(excluded.blocked).toContain(CANDIDATE_SCORE_BLOCKS.versionExcluded)

    const aligned = scoreCandidate(song({ name: 'Song (Live)' }), track({ title: 'Song (Live)' }), config())
    expect(aligned.eligible).toBe(true)
    expect(aligned.blocked).toEqual([])
  })

  it('deducts ten points per version review category, capped at thirty', () => {
    const single = scoreCandidate(song({ name: 'Song (Remastered 2011)' }), track(), config())
    expect(single.eligible).toBe(true)
    expect(single.total).toBe(90)
    expect(single.risks).toContain('version-review:重制信息不同，需确认')

    const triple = scoreCandidate(
      song({ name: 'Song (Remastered 2011) (Radio Edit) [Explicit]' }),
      track({ title: 'Song (Remastered 2020) [Clean]' }),
      config({ explicitPolicy: 'review' }),
    )
    expect(triple.eligible).toBe(true)
    expect(triple.risks.filter(risk => risk.startsWith('version-review:')).length).toBe(3)
    expect(triple.total).toBe(70)
  })
})

describe('media identity and policy blocks', () => {
  it('blocks foreign filename ids and missing or duplicated media paths', () => {
    expect(scoreCandidate(song(), track({ Media: [{ Part: [{ file: '/music/[netease-999] Song.flac' }] }] }), config()).blocked)
      .toContain(CANDIDATE_SCORE_BLOCKS.foreignNeteaseId)
    expect(scoreCandidate(song(), track({ Media: [{ Part: [{ file: '/music/[netease-42] Song.flac' }] }] }), config()).eligible).toBe(true)
    expect(scoreCandidate(song(), track({ Media: [] }), config()).blocked).toContain(CANDIDATE_SCORE_BLOCKS.pathsMissing)
    expect(scoreCandidate(song(), track({ Media: [{ Part: [{ file: '/music/a.flac' }] }, { Part: [{ file: '/music/b.flac' }] }] }), config()).blocked)
      .toContain(CANDIDATE_SCORE_BLOCKS.pathsNotUnique)
  })

  it('blocks configured requirements while preferences only lower the parts', () => {
    const preferred = scoreCandidate(song(), track({ parentTitle: 'Other Album' }), config())
    expect(preferred.eligible).toBe(true)
    expect(preferred.parts.album).toBe(0)
    expect(preferred.parts.track).toBe(0)
    expect(preferred.risks).toContain('album-mismatch')

    const albumRequired = scoreCandidate(song(), track({ parentTitle: 'Other Album' }), config({ albumPolicy: 'require' }))
    expect(albumRequired.eligible).toBe(false)
    expect(albumRequired.blocked).toContain(CANDIDATE_SCORE_BLOCKS.albumRequired)

    const trackRequired = scoreCandidate(song(), track({ index: 5 }), config({ trackPolicy: 'require' }))
    expect(trackRequired.eligible).toBe(false)
    expect(trackRequired.blocked).toContain(CANDIDATE_SCORE_BLOCKS.trackRequired)
    expect(trackRequired.risks).toContain('track-mismatch')
  })

  it('blocks missing duration only when the config excludes it', () => {
    const excluded = scoreCandidate(song({ dt: 0 }), track({ duration: undefined }), config({ missingDuration: 'exclude' }))
    expect(excluded.eligible).toBe(false)
    expect(excluded.blocked).toContain(CANDIDATE_SCORE_BLOCKS.missingDuration)
  })
})
