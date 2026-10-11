import { describe, expect, it } from 'vitest'
import {
  buildNeteasePlaylistCursor,
  buildPlexPlaylistFingerprint,
  classifyPlexPlaylistObservation,
} from '~~/server/lib/sync/playlist-fingerprint'

describe('Plex playlist content fingerprint', () => {
  it('is stable when Plex reallocates playlist item ids', () => {
    const before = buildPlexPlaylistFingerprint([
      { ratingKey: '101', playlistItemID: 9001 },
      { ratingKey: '202', playlistItemID: 9002 },
    ])
    const after = buildPlexPlaylistFingerprint([
      { ratingKey: '101', playlistItemID: 42 },
      { ratingKey: '202', playlistItemID: 43 },
    ])

    expect(after).toBe(before)
    expect(after).toMatch(/^plex-playlist-v1:[a-f0-9]{64}$/)
  })

  it('changes for order, duplicate count, or rating-key changes', () => {
    const baseline = buildPlexPlaylistFingerprint([
      { ratingKey: '101' },
      { ratingKey: '202' },
      { ratingKey: '202' },
    ])

    expect(buildPlexPlaylistFingerprint([
      { ratingKey: '202' },
      { ratingKey: '101' },
      { ratingKey: '202' },
    ])).not.toBe(baseline)
    expect(buildPlexPlaylistFingerprint([
      { ratingKey: '101' },
      { ratingKey: '202' },
    ])).not.toBe(baseline)
    expect(buildPlexPlaylistFingerprint([
      { ratingKey: '101' },
      { ratingKey: '303' },
      { ratingKey: '202' },
    ])).not.toBe(baseline)
  })

  it('normalizes equivalent Unicode rating keys without changing identity', () => {
    expect(buildPlexPlaylistFingerprint([{ ratingKey: ' cafe\u0301 ' }]))
      .toBe(buildPlexPlaylistFingerprint([{ ratingKey: 'café' }]))
  })

  it('rejects missing rating keys instead of silently collapsing occurrences', () => {
    expect(() => buildPlexPlaylistFingerprint([{ ratingKey: ' ' }]))
      .toThrow('Plex playlist occurrence at index 0 has no ratingKey')
  })
})

describe('Plex playlist observation classification', () => {
  it('recognizes the verified result of our own previous write', () => {
    expect(classifyPlexPlaylistObservation('fp-a', {
      lastObservedPlexFingerprint: 'fp-before-write',
      lastAppliedPlexFingerprint: 'fp-a',
    })).toBe('matches_last_applied')
  })

  it('distinguishes a new external change from an unchanged external state', () => {
    expect(classifyPlexPlaylistObservation('fp-b', {
      lastObservedPlexFingerprint: 'fp-a',
      lastAppliedPlexFingerprint: 'fp-a',
    })).toBe('external_change')

    expect(classifyPlexPlaylistObservation('fp-b', {
      lastObservedPlexFingerprint: 'fp-b',
      lastAppliedPlexFingerprint: 'fp-a',
    })).toBe('unchanged_external_state')
  })

  it('marks the first content observation explicitly', () => {
    expect(classifyPlexPlaylistObservation('fp-a', {
      lastObservedPlexFingerprint: null,
      lastAppliedPlexFingerprint: null,
    })).toBe('initial')
  })
})

describe('NetEase playlist observation cursor', () => {
  it('is stable across numeric/string song id representations', () => {
    expect(buildNeteasePlaylistCursor({ trackIds: [1, 2], trackUpdateTime: 123 }))
      .toBe(buildNeteasePlaylistCursor({ trackIds: ['1', '2'], trackUpdateTime: 123 }))
  })

  it('changes when the ordered snapshot or update marker changes', () => {
    const baseline = buildNeteasePlaylistCursor({ trackIds: [1, 2], trackUpdateTime: 123 })
    expect(buildNeteasePlaylistCursor({ trackIds: [2, 1], trackUpdateTime: 123 })).not.toBe(baseline)
    expect(buildNeteasePlaylistCursor({ trackIds: [1, 2], trackUpdateTime: 124 })).not.toBe(baseline)
  })
})
