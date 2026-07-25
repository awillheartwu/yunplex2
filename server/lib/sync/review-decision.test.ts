import { describe, expect, it } from 'vitest'
import type { MatchReview } from './identity-store'
import { buildAcceptedReviewBinding } from './review-decision'

function review(overrides: Partial<MatchReview> = {}): MatchReview {
  return {
    id: 'review-1',
    neteaseSongId: 1,
    sourceId: null,
    runId: null,
    candidatePlexFilePath: '/volume1/music/Artist/Album/exact.flac',
    candidatePlexRatingKey: 'rating-1',
    candidateMbRecordingId: null,
    evidenceType: 'metadata',
    evidence: {},
    status: 'pending',
    decision: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    decidedAt: null,
    ...overrides,
  }
}

describe('accepted review binding preparation', () => {
  it('prefers the reviewed path across every Plex media part without persisting an untyped Plex MBID as a recording', () => {
    const binding = buildAcceptedReviewBinding({
      review: review(),
      sectionKey: '12',
      sectionRoot: '/volume1/music',
      track: {
        ratingKey: 'rating-1',
        title: 'Track',
        grandparentTitle: 'Artist',
        parentTitle: 'Album',
        Guid: [{ id: 'mbid://aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }],
        Media: [
          { Part: [{ file: '/volume1/music/other.mp3' }] },
          { Part: [{ file: '/volume1/music/Artist/Album/exact.flac' }] },
        ],
      },
    })

    expect(binding).toMatchObject({
      plexSectionKey: '12',
      plexFilePath: '/volume1/music/Artist/Album/exact.flac',
      plexRatingKey: 'rating-1',
      mbRecordingId: null,
    })
  })

  it('refuses a Plex metadata item without a bindable media file', () => {
    expect(() => buildAcceptedReviewBinding({
      review: review(),
      sectionKey: '12',
      sectionRoot: '/volume1/music',
      track: { ratingKey: 'rating-1', title: 'Track', grandparentTitle: 'Artist', parentTitle: 'Album' },
    })).toThrow('没有可绑定的媒体路径')
  })
})
