import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/lib/plex-client', () => ({
  insertTrackIntoPlaylist: vi.fn(),
  getPlaylistItemId: vi.fn(),
  movePlaylistItemAfter: vi.fn(),
  movePlaylistItemToTop: vi.fn(),
  removeTrackFromPlaylist: vi.fn(),
}))

import { applyFullReorder, computeLCS, PlexReorderError } from '../../server/lib/sync/reorder'
import { insertTrackIntoPlaylist } from '../../server/lib/plex-client'

beforeEach(() => {
  vi.clearAllMocks()
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
    // Any single element is the LCS — the algorithm picks one based on DP backtracking
    expect(result.size).toBe(1)
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
})
