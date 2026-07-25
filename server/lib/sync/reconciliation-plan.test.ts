import { describe, expect, it } from 'vitest'
import { buildReconciliationPlan } from './reconciliation-plan'

const strongPathTrace = {
  source: 'identity_binding' as const,
  identity: {
    method: 'path' as const,
    plexFilePath: '/volume1/music/song.flac',
    bindingStatus: 'active' as const,
  },
}

describe('buildReconciliationPlan', () => {
  it('preserves an unknown extra even when every target is resolved', () => {
    const plan = buildReconciliationPlan({
      targets: [{ neteaseSongId: 1, plexRatingKey: 'target', matchTrace: strongPathTrace }],
      currentItems: [
        { ratingKey: 'target', playlistItemId: 10 },
        { ratingKey: 'unknown', playlistItemId: 11 },
      ],
    })

    expect([...plan.authorizedRemovalItemIds]).toEqual([])
    expect(plan.allowExtra).toBe(true)
  })

  it('observes an unknown extra once before removing it in balanced mode', () => {
    const first = buildReconciliationPlan({
      targets: [{ neteaseSongId: 1, plexRatingKey: 'target', matchTrace: strongPathTrace }],
      currentItems: [
        { ratingKey: 'target', playlistItemId: 10, observationKey: 'path:/music/target.flac' },
        { ratingKey: 'unknown', playlistItemId: 11, observationKey: 'path:/music/old.flac' },
      ],
      extraTrackRemovalPolicy: 'balanced',
      extraObservationCounts: new Map([['path:/music/old.flac', 1]]),
    })
    const second = buildReconciliationPlan({
      targets: [{ neteaseSongId: 1, plexRatingKey: 'target', matchTrace: strongPathTrace }],
      currentItems: [
        { ratingKey: 'target', playlistItemId: 10, observationKey: 'path:/music/target.flac' },
        { ratingKey: 'unknown', playlistItemId: 11, observationKey: 'path:/music/old.flac' },
      ],
      extraTrackRemovalPolicy: 'balanced',
      extraObservationCounts: new Map([['path:/music/old.flac', 2]]),
    })

    expect(first.removalDecisions[0]).toMatchObject({ action: 'preserve', playlistItemId: 11 })
    expect(first.removalDecisions[0]?.reason).toContain('第 1/2 次')
    expect([...second.authorizedRemovalItemIds]).toEqual([11])
    expect(second.removalDecisions[0]).toMatchObject({
      action: 'remove',
      playlistItemId: 11,
      reason: 'stable_unknown_extra',
    })
  })

  it('removes an unknown extra immediately in exact mode when every target has a strong identity', () => {
    const plan = buildReconciliationPlan({
      targets: [{ neteaseSongId: 1, plexRatingKey: 'target', matchTrace: strongPathTrace }],
      currentItems: [
        { ratingKey: 'target', playlistItemId: 10 },
        { ratingKey: 'unknown', playlistItemId: 11 },
      ],
      extraTrackRemovalPolicy: 'exact',
    })

    expect([...plan.authorizedRemovalItemIds]).toEqual([11])
    expect(plan.removalDecisions[0]).toMatchObject({
      action: 'remove',
      reason: 'complete_target_unknown_extra',
    })
  })

  it('never uses balanced or exact cleanup while the target order is incomplete', () => {
    for (const policy of ['balanced', 'exact'] as const) {
      const plan = buildReconciliationPlan({
        expectedTargetSongIds: [1, 2],
        targets: [{ neteaseSongId: 1, plexRatingKey: 'target', matchTrace: strongPathTrace }],
        currentItems: [{ ratingKey: 'unknown', playlistItemId: 11, observationKey: 'rating:unknown' }],
        extraTrackRemovalPolicy: policy,
        extraObservationCounts: new Map([['rating:unknown', 99]]),
      })

      expect([...plan.authorizedRemovalItemIds]).toEqual([])
    }
  })

  it('keeps pathless or target-path aliases out of balanced automatic cleanup', () => {
    const plan = buildReconciliationPlan({
      targets: [{ neteaseSongId: 1, plexRatingKey: 'target', matchTrace: strongPathTrace }],
      currentItems: [
        { ratingKey: 'target', playlistItemId: 10, observationKey: 'path:/music/song.flac' },
        { ratingKey: 'alias', playlistItemId: 11, observationKey: 'path:/music/song.flac' },
        { ratingKey: 'pathless', playlistItemId: 12, observationKey: 'rating:pathless' },
      ],
      extraTrackRemovalPolicy: 'balanced',
      extraObservationCounts: new Map([
        ['path:/music/song.flac', 10],
        ['rating:pathless', 10],
      ]),
    })

    expect([...plan.authorizedRemovalItemIds]).toEqual([])
    expect(plan.removalDecisions).toEqual([
      expect.objectContaining({ action: 'preserve', playlistItemId: 11 }),
      expect.objectContaining({ action: 'preserve', playlistItemId: 12 }),
    ])
  })

  it('authorizes only the surplus occurrence of a strongly bound target', () => {
    const plan = buildReconciliationPlan({
      targets: [{ neteaseSongId: 1, plexRatingKey: 'target', matchTrace: strongPathTrace }],
      currentItems: [
        { ratingKey: 'target', playlistItemId: 10 },
        { ratingKey: 'target', playlistItemId: 11 },
      ],
    })

    expect([...plan.authorizedRemovalItemIds]).toEqual([11])
    expect(plan.removalDecisions).toContainEqual(expect.objectContaining({
      action: 'remove',
      playlistItemId: 11,
      reason: 'surplus_bound_occurrence',
    }))
  })

  it('authorizes an extra whose durable identity belongs to a song absent from the target', () => {
    const plan = buildReconciliationPlan({
      targets: [{ neteaseSongId: 1, plexRatingKey: 'target', matchTrace: strongPathTrace }],
      currentItems: [
        { ratingKey: 'target', playlistItemId: 10 },
        { ratingKey: 'removed', playlistItemId: 11 },
      ],
      knownCurrentIdentities: [{ neteaseSongId: 2, plexRatingKey: 'removed' }],
    })

    expect([...plan.authorizedRemovalItemIds]).toEqual([11])
  })

  it('never authorizes an unresolved candidate or unrelated extra when target order is incomplete', () => {
    const plan = buildReconciliationPlan({
      targets: [
        { neteaseSongId: 1, plexRatingKey: 'target', matchTrace: strongPathTrace },
        {
          neteaseSongId: 2,
          matchTrace: {
            source: 'pending_review',
            candidate: { ratingKey: 'candidate' },
            decision: 'pending_review',
          },
        },
      ],
      currentItems: [
        { ratingKey: 'target', playlistItemId: 10 },
        { ratingKey: 'candidate', playlistItemId: 11 },
        { ratingKey: 'unknown', playlistItemId: 12 },
      ],
    })

    expect([...plan.authorizedRemovalItemIds]).toEqual([])
    expect(plan.removalDecisions).toEqual([
      expect.objectContaining({ action: 'preserve', playlistItemId: 11 }),
      expect.objectContaining({ action: 'preserve', playlistItemId: 12 }),
    ])
  })

  it('honours the source-level keep-extra policy before every other rule', () => {
    const plan = buildReconciliationPlan({
      targets: [{ neteaseSongId: 1, plexRatingKey: 'target', matchTrace: strongPathTrace }],
      currentItems: [
        { ratingKey: 'target', playlistItemId: 10 },
        { ratingKey: 'target', playlistItemId: 11 },
      ],
      skipRemoveExtraTracks: true,
    })

    expect([...plan.authorizedRemovalItemIds]).toEqual([])
  })

  it('treats trackIds missing from song_detail as unresolved targets and never deletes their binding', () => {
    const plan = buildReconciliationPlan({
      expectedTargetSongIds: [1, 2],
      targets: [{ neteaseSongId: 1, plexRatingKey: 'target', matchTrace: strongPathTrace }],
      currentItems: [
        { ratingKey: 'target', playlistItemId: 10 },
        { ratingKey: 'missing-detail-binding', playlistItemId: 11 },
      ],
      knownCurrentIdentities: [{ neteaseSongId: 2, plexRatingKey: 'missing-detail-binding' }],
    })

    expect(plan.hasIncompleteTargetOrder).toBe(true)
    expect([...plan.authorizedRemovalItemIds]).toEqual([])
  })

  it('does not put a weak ratingKey into the target order', () => {
    const plan = buildReconciliationPlan({
      targets: [{
        neteaseSongId: 1,
        plexRatingKey: 'weak',
        matchTrace: { source: 'plex_search', decision: 'pending_review' },
      }],
      currentItems: [{ ratingKey: 'weak', playlistItemId: 10 }],
    })

    expect(plan.targetOrder).toEqual([])
    expect(plan.hasIncompleteTargetOrder).toBe(true)
  })

  it('protects a pending candidate before considering an obsolete binding for deletion', () => {
    const plan = buildReconciliationPlan({
      expectedTargetSongIds: [1],
      targets: [{
        neteaseSongId: 1,
        matchTrace: { source: 'pending_review', candidate: { ratingKey: 'candidate' } },
      }],
      currentItems: [{ ratingKey: 'candidate', playlistItemId: 10 }],
      knownCurrentIdentities: [{ neteaseSongId: 2, plexRatingKey: 'candidate' }],
    })

    expect([...plan.authorizedRemovalItemIds]).toEqual([])
    expect(plan.removalDecisions[0]).toMatchObject({ action: 'preserve', playlistItemId: 10 })
  })

  it('requires a confirmed empty snapshot before authorizing deletion', () => {
    const protectedPlan = buildReconciliationPlan({
      expectedTargetSongIds: [],
      targets: [],
      currentItems: [{ ratingKey: 'old', playlistItemId: 10 }],
      knownCurrentIdentities: [{ neteaseSongId: 2, plexRatingKey: 'old' }],
    })
    const confirmedPlan = buildReconciliationPlan({
      expectedTargetSongIds: [],
      targets: [],
      currentItems: [{ ratingKey: 'old', playlistItemId: 10 }],
      knownCurrentIdentities: [{ neteaseSongId: 2, plexRatingKey: 'old' }],
      allowEmptyRemoval: true,
    })

    expect([...protectedPlan.authorizedRemovalItemIds]).toEqual([])
    expect([...confirmedPlan.authorizedRemovalItemIds]).toEqual([10])
  })
})
