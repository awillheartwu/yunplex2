import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/lib/plex-client', () => ({
  insertTrackIntoPlaylist: vi.fn(),
  getPlaylistItemIds: vi.fn(),
  movePlaylistItemAfter: vi.fn(),
  movePlaylistItemToTop: vi.fn(),
  removeTrackFromPlaylist: vi.fn(),
  getPlaylistTracks: vi.fn(),
}))

import { applyFullReorder, computeLCS, PlexReorderError, validatePlaylistOrder } from '../../server/lib/sync/reorder'
import {
  getPlaylistItemIds,
  getPlaylistTracks,
  insertTrackIntoPlaylist,
  movePlaylistItemToTop,
  removeTrackFromPlaylist,
} from '../../server/lib/plex-client'

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getPlaylistTracks).mockResolvedValue([])
})

describe('validatePlaylistOrder', () => {
  it('passes when target tracks are present in order and no extras are disallowed', () => {
    const result = validatePlaylistOrder(
      ['a', 'b'],
      [{ ratingKey: 'a' }, { ratingKey: 'b' }],
      { allowExtra: false },
    )

    expect(result.ok).toBe(true)
  })

  it('fails when a target track is missing', () => {
    const result = validatePlaylistOrder(
      ['a', 'b'],
      [{ ratingKey: 'a' }],
      { allowExtra: false },
    )

    expect(result.ok).toBe(false)
    expect(result.missing).toEqual(['b'])
  })

  it('fails when target tracks are out of order', () => {
    const result = validatePlaylistOrder(
      ['a', 'b'],
      [{ ratingKey: 'b' }, { ratingKey: 'a' }],
      { allowExtra: false },
    )

    expect(result.ok).toBe(false)
    expect(result.currentTargetOrder).toEqual(['b', 'a'])
  })

  it('allows extra tracks when removal is disabled', () => {
    const result = validatePlaylistOrder(
      ['a', 'b'],
      [{ ratingKey: 'x' }, { ratingKey: 'a' }, { ratingKey: 'b' }],
      { allowExtra: true },
    )

    expect(result.ok).toBe(true)
    expect(result.extra).toEqual([])
  })

  it('reports extra tracks when removal is expected', () => {
    const result = validatePlaylistOrder(
      ['a', 'b'],
      [{ ratingKey: 'x' }, { ratingKey: 'a' }, { ratingKey: 'b' }],
      { allowExtra: false },
    )

    expect(result.ok).toBe(false)
    expect(result.extra).toEqual(['x'])
  })

  it('fails when a duplicate target occurrence is missing', () => {
    const result = validatePlaylistOrder(
      ['a', 'a', 'b'],
      [{ ratingKey: 'a' }, { ratingKey: 'b' }],
      { allowExtra: false },
    )

    expect(result.ok).toBe(false)
    expect(result.missing).toEqual(['a'])
  })

  it('reports surplus duplicate occurrences when removal is expected', () => {
    const result = validatePlaylistOrder(
      ['a', 'b'],
      [{ ratingKey: 'a' }, { ratingKey: 'a' }, { ratingKey: 'b' }],
      { allowExtra: false },
    )

    expect(result.ok).toBe(false)
    expect(result.extra).toEqual(['a'])
  })

  it('allows surplus duplicate occurrences when extra tracks are allowed and target order is a subsequence', () => {
    const result = validatePlaylistOrder(
      ['a', 'b'],
      [{ ratingKey: 'x' }, { ratingKey: 'a' }, { ratingKey: 'a' }, { ratingKey: 'b' }],
      { allowExtra: true },
    )

    expect(result.ok).toBe(true)
    expect(result.extra).toEqual([])
  })
})

describe('computeLCS', () => {
  it('returns all elements for identical arrays', () => {
    const result = computeLCS([1, 2, 3], [1, 2, 3])
    expect(result).toEqual(new Set([1, 2, 3]))
  })

  it('returns common subsequence', () => {
    const result = computeLCS([1, 2, 3], [1, 3, 5])
    expect(result).toEqual(new Set([1, 3]))
  })

  it('returns empty set when no common elements', () => {
    const result = computeLCS([1, 2], [3, 4])
    expect(result).toEqual(new Set())
  })

  it('returns empty set when both arrays are empty', () => {
    const result = computeLCS([], [])
    expect(result).toEqual(new Set())
  })

  it('returns empty set when one array is empty', () => {
    expect(computeLCS([1, 2], [])).toEqual(new Set())
    expect(computeLCS([], [1, 2])).toEqual(new Set())
  })

  it('returns matching single element', () => {
    expect(computeLCS([5], [5])).toEqual(new Set([5]))
  })

  it('returns empty set for mismatched single element', () => {
    expect(computeLCS([5], [3])).toEqual(new Set())
  })

  it('handles reversed arrays (LCS length 1)', () => {
    const result = computeLCS([1, 2, 3], [3, 2, 1])
    // Preserve the original full-table backtracking preference on ties.
    expect(result).toEqual(new Set([1]))
  })

  it('preserves the original tie-breaking when multiple longer subsequences exist', () => {
    expect(computeLCS([1, 2, 3], [2, 1, 3])).toEqual(new Set([1, 3]))
  })

  it('handles duplicate elements', () => {
    const result = computeLCS([1, 1, 2], [1, 2, 2])
    expect(result).toEqual(new Set([1, 2]))
  })

  it('handles longer sequences without error', () => {
    const a = Array.from({ length: 50 }, (_, i) => i)
    const b = Array.from({ length: 50 }, (_, i) => i % 2 === 0 ? i : i + 100)
    const result = computeLCS(a, b)
    // Only even numbers match
    expect(result.size).toBe(25)
    for (let i = 0; i < 50; i += 2) {
      expect(result.has(i)).toBe(true)
    }
  })

  it('handles a large worst-case reorder within a bounded heap', () => {
    const size = 5_000
    const currentOrder = Array.from({ length: size }, (_, index) => index)
    const targetOrder = currentOrder.toReversed()

    const result = computeLCS(currentOrder, targetOrder)

    expect(result).toEqual(new Set([0]))
  }, 15_000)

  it('throws when Plex insert fails instead of silently reporting success', async () => {
    vi.mocked(insertTrackIntoPlaylist).mockRejectedValue(new Error('Plex insert failed'))

    await expect(applyFullReorder(
      'playlist-1',
      ['rating-1'],
      [],
      'section-1',
      () => false,
      () => {},
    )).rejects.toBeInstanceOf(PlexReorderError)
  })

  it('never removes an old item when inserting its replacement fails', async () => {
    vi.mocked(insertTrackIntoPlaylist).mockRejectedValue(new Error('Plex insert failed'))

    await expect(applyFullReorder(
      'playlist-1',
      ['new-rating'],
      [{ ratingKey: 'old-rating', playlistItemId: 101 }],
      'section-1',
      () => false,
      () => {},
      { authorizedRemovalItemIds: new Set([101]) },
    )).rejects.toBeInstanceOf(PlexReorderError)

    expect(removeTrackFromPlaylist).not.toHaveBeenCalled()
  })

  it('inserts missing duplicate target occurrences', async () => {
    vi.mocked(insertTrackIntoPlaylist).mockResolvedValue(undefined)
    vi.mocked(getPlaylistItemIds).mockResolvedValue([101, 102])

    const result = await applyFullReorder(
      'playlist-1',
      ['rating-1', 'rating-1'],
      [{ ratingKey: 'rating-1', playlistItemId: 101 }],
      'section-1',
      () => false,
      () => {},
    )

    expect(result.inserted).toBe(1)
    expect(insertTrackIntoPlaylist).toHaveBeenCalledTimes(1)
    expect(insertTrackIntoPlaylist).toHaveBeenCalledWith('playlist-1', 'rating-1')
  })

  it('removes surplus duplicate occurrences when exact sync is expected', async () => {
    vi.mocked(removeTrackFromPlaylist).mockResolvedValue(undefined)
    vi.mocked(getPlaylistTracks).mockResolvedValue([
      { ratingKey: 'rating-1' },
      { ratingKey: 'rating-1' },
    ] as any)

    const result = await applyFullReorder(
      'playlist-1',
      ['rating-1'],
      [
        { ratingKey: 'rating-1', playlistItemId: 101 },
        { ratingKey: 'rating-1', playlistItemId: 102 },
      ],
      'section-1',
      () => false,
      () => {},
      { authorizedRemovalItemIds: new Set([102]) },
    )

    expect(result.removed).toBe(1)
    expect(removeTrackFromPlaylist).toHaveBeenCalledWith('playlist-1', 102)
  })

  it('preserves every extra occurrence unless its concrete playlist item ID is authorized', async () => {
    const result = await applyFullReorder(
      'playlist-1',
      ['rating-1'],
      [
        { ratingKey: 'rating-1', playlistItemId: 101 },
        { ratingKey: 'old-rating', playlistItemId: 102 },
      ],
      'section-1',
      () => false,
      () => {},
    )

    expect(result.removed).toBe(0)
    expect(result.preserved).toBe(1)
    expect(result.mutations).toContainEqual({
      action: 'preserve',
      ratingKey: 'old-rating',
      playlistItemId: 102,
      reason: '未获得逐项强身份删除授权',
    })
    expect(removeTrackFromPlaylist).not.toHaveBeenCalled()
  })

  it('does not remove authorized extras when target reordering fails', async () => {
    vi.mocked(movePlaylistItemToTop).mockRejectedValue(new Error('Plex move failed'))

    await expect(applyFullReorder(
      'playlist-1',
      ['rating-2', 'rating-1'],
      [
        { ratingKey: 'rating-1', playlistItemId: 101 },
        { ratingKey: 'rating-2', playlistItemId: 102 },
        { ratingKey: 'old-rating', playlistItemId: 103 },
      ],
      'section-1',
      () => false,
      () => {},
      { authorizedRemovalItemIds: new Set([103]) },
    )).rejects.toBeInstanceOf(PlexReorderError)

    expect(removeTrackFromPlaylist).not.toHaveBeenCalled()
  })

  it('does not delete authorized old items when Plex move calls are no-ops', async () => {
    vi.mocked(getPlaylistTracks).mockResolvedValue([
      { ratingKey: 'rating-1' },
      { ratingKey: 'rating-2' },
      { ratingKey: 'old-rating' },
    ] as any)

    await expect(applyFullReorder(
      'playlist-1',
      ['rating-2', 'rating-1'],
      [
        { ratingKey: 'rating-1', playlistItemId: 101 },
        { ratingKey: 'rating-2', playlistItemId: 102 },
        { ratingKey: 'old-rating', playlistItemId: 103 },
      ],
      'section-1',
      () => false,
      () => {},
      { authorizedRemovalItemIds: new Set([103]) },
    )).rejects.toBeInstanceOf(PlexReorderError)

    expect(getPlaylistTracks).toHaveBeenCalledTimes(3)
    expect(removeTrackFromPlaylist).not.toHaveBeenCalled()
  })

  it('retains confirmed removal mutations when a later occurrence fails', async () => {
    vi.mocked(getPlaylistTracks).mockResolvedValue([
      { ratingKey: 'target' },
      { ratingKey: 'old-1' },
      { ratingKey: 'old-2' },
    ] as any)
    vi.mocked(removeTrackFromPlaylist)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('second delete failed'))

    let error: PlexReorderError | undefined
    try {
      await applyFullReorder(
        'playlist-1',
        ['target'],
        [
          { ratingKey: 'target', playlistItemId: 100 },
          { ratingKey: 'old-1', playlistItemId: 101 },
          { ratingKey: 'old-2', playlistItemId: 102 },
        ],
        'section-1',
        () => false,
        () => {},
        { authorizedRemovalItemIds: new Set([101, 102]) },
      )
    } catch (caught) {
      if (caught instanceof PlexReorderError) error = caught
      else throw caught
    }

    expect(error).toBeInstanceOf(PlexReorderError)
    expect(error?.result.removed).toBe(1)
    expect(error?.result.mutations).toContainEqual({
      action: 'remove',
      ratingKey: 'old-1',
      playlistItemId: 101,
    })
  })
})
